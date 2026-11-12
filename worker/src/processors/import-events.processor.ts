import type { Payload } from 'payload'

import { getMunicipalityAdminUserIds, getPlatformDeciders, sendNotificationToMany } from '@/collections/shared/notify'
import { ImportAiError, ImportAiUnavailableError } from '@/lib/import/ai'
import { IMPORT_LIMITS, isFullPass, isImportFileType, type SourceTrigger } from '@/lib/import/contracts'
import { ImportFetchError } from '@/lib/import/fetch'
import { defaultImportDeps, ImportReadError, loadImportContext, readUrl, storeCandidates, waiveRobotsFor, type ImportDeps } from '@/lib/import/pipeline'
import { deleteImportFile, downloadImportFile } from '@/lib/import/storage'
import { addDays, pragueToday } from '@/lib/import/time'
import { aiRefusalFor, emptyTotals, isAiHeldBack, meterAi, type UsageTotals } from '@/lib/import/usage'
import { sourcesWithinPackage } from '@/lib/billing/scraping'
import { checkScrapingCost } from '@/lib/billing/scraping-cost'
import { logger, serializeError } from '@/lib/logger'
import { relationId, relationNumber } from '@/lib/relations'

import { getWorkerPayload } from '../runtime/payload'

import type { ImportEventsJobData, ImportEventsJobResult } from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
  /** Attempts the job has in total (queue options) — the last one cleans up after itself. */
  attempts?: number
}

const IMPORT_LINK = '/admin-obce?tab=import'

/** A failure the source or the input causes — said to the owner, not retried. */
const isExpected = (error: unknown) =>
  error instanceof ImportFetchError || error instanceof ImportAiError || error instanceof ImportReadError

const messageOf = (error: unknown) =>
  isExpected(error) || error instanceof ImportAiUnavailableError ? (error as Error).message : 'Zpracování se nepodařilo.'

const codeOf = (error: unknown) =>
  (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'unknown')

const countLabel = (n: number) => (n === 1 ? '1 novou akci' : n >= 2 && n <= 4 ? `${n} nové akce` : `${n} nových akcí`)

type RunStart = {
  municipality: number
  source: number | null
  trigger: SourceTrigger | 'text' | 'file'
  requestedBy: number | null
  jobId?: string
}

type RunEnd = {
  status: 'success' | 'unchanged' | 'failed' | 'skipped'
  format?: string
  error?: string
  errorCode?: string
  found?: number
  created?: number
  updated?: number
  synced?: number
  needsReview?: number
}

/** The run's own record (ImportRuns) — written first, so a crash midway still leaves it "running". */
async function startRun(payload: Payload, run: RunStart, now: Date): Promise<number | null> {
  try {
    const doc = await payload.create({
      collection: 'import-runs',
      data: { ...run, status: 'running', startedAt: now.toISOString() },
      overrideAccess: true,
    })
    return doc.id
  } catch (error) {
    logger.error('Import run not recorded', { event: 'import.run_unrecorded', ...run, ...serializeError(error) })
    return null
  }
}

async function finishRun(payload: Payload, runId: number | null, end: RunEnd, totals: UsageTotals, now: Date) {
  if (!runId) return
  await payload
    .update({
      collection: 'import-runs',
      id: runId,
      data: { ...end, ...totals, finishedAt: now.toISOString() },
      overrideAccess: true,
    })
    .catch((error) =>
      logger.error('Import run not finished', { event: 'import.run_unfinished', runId, ...serializeError(error) }),
    )
}

/**
 * Input tokens the earlier attempts of this job used — from the AI calls on the ledger (usage-events),
 * which are written as they're made, so an attempt that crashed midway counts too. A retry goes on
 * with what's left of the run's cap instead of a fresh one.
 */
async function tokensSpentByEarlierAttempts(payload: Payload, jobId: string | undefined, runId: number | null): Promise<number> {
  if (!jobId) return 0
  const earlier = await payload.find({
    collection: 'import-runs',
    where: {
      and: [
        { jobId: { equals: jobId } },
        ...(runId ? [{ id: { not_equals: runId } }] : []),
        // Job ids can come round again after a long while — only this job's attempts.
        { startedAt: { greater_than: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() } },
      ],
    },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  if (earlier.docs.length === 0) return 0
  const calls = await payload.find({
    collection: 'usage-events',
    where: { importRun: { in: earlier.docs.map((run) => run.id) } },
    select: { inputTokens: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return calls.docs.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0)
}

/** Who looks after what a source brings: the obec's admins. */
async function ownersOf(payload: Payload, source: { municipality: unknown }) {
  return { userIds: await getMunicipalityAdminUserIds(payload, relationNumber(source.municipality)!), link: IMPORT_LINK }
}

/** A source that keeps failing is told to its obec's admins — and past IMPORT_LIMITS.failuresBeforePause
 * switched off (processSource): a page gone for good isn't knocked on every night. */
async function noticeFailures(
  payload: Payload,
  source: { municipality: unknown; label?: string | null; url: string },
  failures: number,
  message: string,
) {
  const paused = failures === IMPORT_LIMITS.failuresBeforePause
  if (failures !== IMPORT_LIMITS.failuresBeforeNotice && !paused) return
  const { userIds, link } = await ownersOf(payload, source)
  const web = source.label || source.url
  await sendNotificationToMany(payload, userIds, {
    title: paused ? 'Zdroj akcí je pozastavený' : 'Zdroj akcí nejde načíst',
    link,
    message: paused
      ? `Web ${web} se nepodařilo načíst ${failures}× po sobě, proto ho přestáváme kontrolovat: ${message} Až bude web v pořádku, zapněte zdroj v sekci Import akcí.`
      : `Web ${web} se nepodařilo načíst už ${failures}× po sobě: ${message} Zkontrolujte adresu v sekci Import akcí.`,
  }).catch((error) =>
    logger.warn('Import failure notice not sent', { event: 'import.failure_notice_failed', ...serializeError(error) }),
  )
}

/** The platform's admins hear of a run the token cap stopped — they check the source in the run log. */
async function reportTokenCap(
  payload: Payload,
  source: { id: number; url: string; label?: string | null },
  municipalityId: number,
  totals: UsageTotals,
  cap: number,
  reason: string,
): Promise<void> {
  logger.warn('Import run stopped at the token cap', {
    event: 'import.token_cap',
    sourceId: source.id,
    municipalityId,
    inputTokens: totals.inputTokens,
    cap,
  })
  try {
    const { userIds } = await getPlatformDeciders(payload)
    await sendNotificationToMany(payload, userIds, {
      title: 'Scraping: běh zastaven limitem tokenů',
      link: `/superadmin/obce/${municipalityId}`,
      message:
        totals.inputTokens > 0
          ? `Zdroj ${source.label || source.url} spotřeboval ${totals.inputTokens.toLocaleString('cs-CZ')} vstupních tokenů (limit ${cap.toLocaleString('cs-CZ')}) a běh se zastavil. Zkontrolujte ho v logu běhů obce.`
          : `Zdroj ${source.label || source.url} se nenačetl: ${reason} Zkontrolujte ho v logu běhů obce.`,
    })
  } catch (error) {
    logger.warn('Token cap report not sent', { event: 'import.token_cap_report_failed', ...serializeError(error) })
  }
}

async function processSource(
  payload: Payload,
  data: Extract<ImportEventsJobData, { kind: 'source' }>,
  deps: ImportDeps,
  context: DispatchContext,
  isLastAttempt: boolean,
): Promise<ImportEventsJobResult> {
  const trigger: SourceTrigger = data.trigger ?? 'daily'
  const source = await payload
    .findByID({ collection: 'event-sources', id: data.sourceId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!source || !source.enabled) return { found: 0, created: 0, updated: 0, skipped: 'source_gone_or_disabled' }
  // An organizer's source from before import became the obec's alone (collections/access/import).
  if (relationId(source.organization)) return { found: 0, created: 0, updated: 0, skipped: 'organizer_source' }
  const municipalityId = relationNumber(source.municipality)!
  const importContext = await loadImportContext(payload, municipalityId)
  if (!importContext) return { found: 0, created: 0, updated: 0, skipped: 'municipality_gone' }
  // Where the AI may be used (the obec pays for scraping and isn't suspended), only the sources its
  // package covers are read — whoever asked (the weekly slot, "Projít teď", a source switched back
  // on); one left switched on past a smaller package waits (lib/billing/scraping). Without the AI
  // (not subscribed, suspended) a read costs nothing — iCal and schema.org only — and isn't capped.
  if (
    importContext.aiEnabled &&
    !importContext.suspended &&
    !(await sourcesWithinPackage(payload, municipalityId)).has(source.id)
  ) {
    logger.info('Import source outside the package, not read', {
      event: 'import.source_outside_package',
      sourceId: source.id,
      municipalityId,
    })
    return { found: 0, created: 0, updated: 0, skipped: 'outside_package' }
  }

  const now = deps.now()
  const runAt = now.toISOString()
  const requestedBy = relationNumber(data.requestedBy)
  const runId = await startRun(
    payload,
    { municipality: municipalityId, source: source.id, trigger, requestedBy, jobId: context.jobId },
    now,
  )
  const totals = emptyTotals()
  const metered = meterAi(
    // The obec runs the web and let us past its robots.txt (EventSources.ignoreRobots).
    source.ignoreRobots ? waiveRobotsFor(deps, source.url) : deps,
    payload,
    { municipality: municipalityId, user: requestedBy, eventSource: source.id, importRun: runId },
    {
      refusal: await aiRefusalFor(payload, importContext),
      totals,
      maxInputTokens: importContext.maxInputTokensPerRun,
      spentBefore: (context.attemptsMade ?? 0) > 0 ? await tokensSpentByEarlierAttempts(payload, context.jobId, runId) : 0,
    },
  )
  // The panel shows it being read (ImportPanel) until one of the updates below clears it.
  await payload
    .update({
      collection: 'event-sources',
      id: source.id,
      data: { runningSince: runAt, queuedAt: null },
      overrideAccess: true,
    })
    .catch(() => {})

  // Only the next weeks (IMPORT_LIMITS.sourceWindowDays) — each pass takes what came into the window.
  const until = addDays(pragueToday(now), IMPORT_LIMITS.sourceWindowDays)
  const aiContext = { ...importContext.aiContext, until }

  try {
    const read = await readUrl(
      source.url,
      // A full pass reads the page whether it changed or not.
      isFullPass(trigger)
        ? { aiContext }
        : {
            previousHash: source.lastContentHash,
            aiContext,
            previous: {
              format: source.format,
              validators: { etag: source.etag ?? null, lastModified: source.lastModified ?? null },
            },
          },
      metered,
    )
    const stored = read.unchanged
      ? { created: 0, updated: 0, createdIds: [], synced: 0, needsReview: 0 }
      : await storeCandidates(
          payload,
          {
            municipality: importContext.municipality,
            events: read.events,
            origin: 'source',
            originLabel: source.url,
            sourceId: source.id,
            requestedBy: null,
            until,
            fullPass: isFullPass(trigger),
            format: read.format,
          },
          metered,
        )
    await payload.update({
      collection: 'event-sources',
      id: source.id,
      data: {
        format: read.format,
        lastRunAt: runAt,
        lastSuccessAt: runAt,
        lastError: null,
        lastErrorCode: null,
        consecutiveFailures: 0,
        runningSince: null,
        lastContentHash: read.contentHash,
        etag: read.validators?.etag ?? null,
        lastModified: read.validators?.lastModified ?? null,
        ...(read.unchanged ? {} : { lastFoundCount: read.events.length }),
      },
      overrideAccess: true,
    })
    const owners = stored.created + stored.synced + stored.needsReview > 0 ? await ownersOf(payload, source) : null
    if (owners && stored.created > 0) {
      await sendNotificationToMany(payload, owners.userIds, {
        title: 'Nové akce k převzetí',
        link: owners.link,
        message: `Na webu ${source.label || source.url} jsme našli ${countLabel(stored.created)}. Zkontrolujte je a převezměte v sekci Import akcí.`,
      })
    }
    if (owners && stored.synced + stored.needsReview > 0) {
      const parts = [
        stored.synced > 0 ? `upraveno podle webu: ${stored.synced}` : null,
        stored.needsReview > 0 ? `ke kontrole: ${stored.needsReview}` : null,
      ].filter(Boolean)
      await sendNotificationToMany(payload, owners.userIds, {
        title: 'Změny u převzatých akcí',
        link: owners.link,
        message: `Na webu ${source.label || source.url} se změnily akce, které už jsou v Lonvitě (${parts.join(', ')}). Přihlášené o úpravách informujeme sami.`,
      })
    }
    await finishRun(
      payload,
      runId,
      {
        status: read.unchanged ? 'unchanged' : 'success',
        format: read.format,
        found: read.events.length,
        created: stored.created,
        updated: stored.updated,
        synced: stored.synced,
        needsReview: stored.needsReview,
      },
      totals,
      deps.now(),
    )
    return { found: read.events.length, created: stored.created, updated: stored.updated, ...(read.unchanged ? { skipped: 'unchanged' } : {}) }
  } catch (error) {
    if (codeOf(error) === 'token_cap') {
      // The technical safety net (Balíčky služeb: "běh se zastaví a superadmin dostane hlášení") — the
      // run stops; not the web's fault, so no failure counted and the fingerprint is left as it was.
      await payload.update({
        collection: 'event-sources',
        id: source.id,
        data: { lastRunAt: runAt, lastError: messageOf(error), lastErrorCode: 'token_cap', runningSince: null },
        overrideAccess: true,
      })
      await finishRun(payload, runId, { status: 'failed', error: messageOf(error), errorCode: 'token_cap' }, totals, deps.now())
      await reportTokenCap(payload, source, municipalityId, totals, importContext.maxInputTokensPerRun, messageOf(error))
      return { found: 0, created: 0, updated: 0, skipped: 'token_cap' }
    }
    if (error instanceof ImportAiUnavailableError) {
      // The AI provider, not the web — tried again by the queue, and never counted against the source.
      // Out of attempts, the run is skipped; the next scheduled pass reads it.
      await finishRun(payload, runId, { status: isLastAttempt ? 'skipped' : 'failed', error: error.message, errorCode: error.code }, totals, deps.now())
      if (!isLastAttempt) throw error
      await payload
        .update({
          collection: 'event-sources',
          id: source.id,
          data: { lastRunAt: runAt, lastError: error.message, lastErrorCode: error.code, runningSince: null },
          overrideAccess: true,
        })
        .catch(() => {})
      logger.warn('Event source not read — AI unavailable', { event: 'import.source_ai_unavailable', sourceId: source.id, status: error.status })
      return { found: 0, created: 0, updated: 0, skipped: 'ai_unavailable' }
    }
    if (isAiHeldBack(error)) {
      // The obec's package, the platform's switch — not the web's fault: no failure counted, nobody
      // told the web is broken, and the page's fingerprint is left as it was, so the next pass the AI
      // may read it again reads it.
      await payload.update({
        collection: 'event-sources',
        id: source.id,
        data: { lastRunAt: runAt, lastError: messageOf(error), lastErrorCode: codeOf(error), runningSince: null },
        overrideAccess: true,
      })
      await finishRun(payload, runId, { status: 'skipped', error: messageOf(error), errorCode: codeOf(error) }, totals, deps.now())
      logger.info('Event source not read by the AI', { event: 'import.source_ai_held_back', sourceId: source.id, code: codeOf(error) })
      return { found: 0, created: 0, updated: 0, skipped: 'ai_held_back' }
    }
    // A failure the queue retries is one failure, counted on its last attempt — not one per attempt.
    if (!isExpected(error) && !isLastAttempt) {
      await finishRun(payload, runId, { status: 'failed', error: messageOf(error), errorCode: codeOf(error) }, totals, deps.now())
      throw error
    }
    const failures = (source.consecutiveFailures ?? 0) + 1
    const pause = failures >= IMPORT_LIMITS.failuresBeforePause
    await payload.update({
      collection: 'event-sources',
      id: source.id,
      data: {
        lastRunAt: runAt,
        lastError: messageOf(error),
        lastErrorCode: codeOf(error),
        consecutiveFailures: failures,
        runningSince: null,
        ...(pause ? { enabled: false } : {}),
      },
      overrideAccess: true,
    })
    await noticeFailures(payload, source, failures, messageOf(error))
    await finishRun(payload, runId, { status: 'failed', error: messageOf(error), errorCode: codeOf(error) }, totals, deps.now())
    if (!isExpected(error)) throw error
    logger.warn('Event source not read', { event: 'import.source_failed', sourceId: source.id, ...serializeError(error) })
    return { found: 0, created: 0, updated: 0, skipped: 'read_failed' }
  }
}

/** A pasted program or an uploaded file — read once, and whoever sent it hears how it went. */
async function processManual(
  payload: Payload,
  data: Extract<ImportEventsJobData, { kind: 'text' | 'file' }>,
  deps: ImportDeps,
  context: DispatchContext,
  isLastAttempt: boolean,
): Promise<ImportEventsJobResult> {
  const what = data.kind === 'text' ? 've vloženém textu' : `v souboru „${data.fileName}“`
  const notify = (title: string, message: string, link?: string) =>
    sendNotificationToMany(payload, [data.requestedBy], { title, message, link })

  const importContext = await loadImportContext(payload, data.municipalityId)
  if (!importContext) return { found: 0, created: 0, updated: 0, skipped: 'municipality_gone' }

  const now = deps.now()
  const municipalityId = importContext.municipality.id
  const requestedBy = Number(data.requestedBy)
  const runId = await startRun(
    payload,
    { municipality: municipalityId, source: null, trigger: data.kind, requestedBy, jobId: context.jobId },
    now,
  )
  const totals = emptyTotals()
  const metered = meterAi(
    deps,
    payload,
    { municipality: municipalityId, user: requestedBy, importRun: runId },
    {
      refusal: await aiRefusalFor(payload, importContext),
      totals,
      maxInputTokens: importContext.maxInputTokensPerRun,
      spentBefore: (context.attemptsMade ?? 0) > 0 ? await tokensSpentByEarlierAttempts(payload, context.jobId, runId) : 0,
    },
  )

  let succeeded = false
  try {
    if (!deps.aiAvailable()) throw new ImportReadError('AI čtení není zapnuté — import z textu a souborů teď nejde.')
    const events =
      data.kind === 'text'
        ? await metered.extractWithAi({ kind: 'text', text: data.text, sourceUrl: null }, importContext.aiContext)
        : isImportFileType(data.mimeType)
          ? await metered.extractWithAi(
              { kind: 'file', data: await downloadImportFile(data.fileKey), mimeType: data.mimeType, fileName: data.fileName },
              importContext.aiContext,
            )
          : []
    const stored = await storeCandidates(
      payload,
      {
        municipality: importContext.municipality,
        events,
        origin: data.kind,
        originLabel: data.kind === 'file' ? data.fileName : null,
        sourceId: null,
        requestedBy,
      },
      metered,
    )
    succeeded = true
    if (stored.created > 0) {
      await notify('Nové akce k převzetí', `${what[0].toUpperCase()}${what.slice(1)} jsme našli ${countLabel(stored.created)}. Zkontrolujte je a převezměte v sekci Import.`, IMPORT_LINK)
    } else {
      await notify('Import nenašel nové akce', `${what[0].toUpperCase()}${what.slice(1)} jsme nenašli žádné nové nadcházející akce.`, IMPORT_LINK)
    }
    await finishRun(payload, runId, { status: 'success', found: events.length, created: stored.created, updated: stored.updated }, totals, deps.now())
    return { found: events.length, created: stored.created, updated: stored.updated }
  } catch (error) {
    await finishRun(payload, runId, { status: 'failed', error: messageOf(error), errorCode: codeOf(error) }, totals, deps.now())
    if (!isExpected(error) && !isLastAttempt) throw error
    logger.warn('Manual import failed', { event: 'import.manual_failed', kind: data.kind, ...serializeError(error) })
    await notify('Import se nepodařil', `Akce ${what} se nepodařilo načíst: ${messageOf(error)}`, IMPORT_LINK)
    return { found: 0, created: 0, updated: 0, skipped: 'read_failed' }
  } finally {
    if (data.kind === 'file' && (succeeded || isLastAttempt)) {
      await deleteImportFile(data.fileKey).catch((error) =>
        logger.warn('Import file not removed', { event: 'import.file_cleanup_failed', key: data.fileKey, ...serializeError(error) }),
      )
    }
  }
}

/**
 * Reads one input into EventImportCandidates (lib/import/pipeline). Every run is on the record
 * (ImportRuns) and every AI call on the usage-events ledger, counted against the obec
 * (lib/import/usage). A source's outcome is also written on the source (its owner sees it next to
 * it), and its owners hear about new events; a pasted program or file is answered to whoever sent
 * it. What the source or the input causes — unreachable, forbidden by robots.txt, unreadable, over
 * the obec's AI budget — isn't retried; anything else is, by the queue.
 */
export const processImportEventsJob = async (
  data: ImportEventsJobData,
  context: DispatchContext = {},
  deps: ImportDeps = defaultImportDeps(),
): Promise<ImportEventsJobResult> => {
  const payload = await getWorkerPayload()
  const isLastAttempt = (context.attemptsMade ?? 0) + 1 >= (context.attempts ?? 3)
  const result =
    data.kind === 'source'
      ? await processSource(payload, data, deps, context, isLastAttempt)
      : await processManual(payload, data, deps, context, isLastAttempt)
  logger.info('Events imported', { event: 'import.finished', kind: data.kind, jobId: context.jobId, ...result })
  // The platform's watch on what the AI costs (lib/billing/scraping-cost) — tells, never blocks.
  const municipalityId =
    data.kind === 'source'
      ? relationNumber(
          (
            await payload
              .findByID({ collection: 'event-sources', id: data.sourceId, depth: 0, overrideAccess: true, select: { municipality: true } })
              .catch(() => null)
          )?.municipality,
        )
      : Number(data.municipalityId)
  if (municipalityId) await checkScrapingCost(payload, municipalityId, deps.now())
  return result
}
