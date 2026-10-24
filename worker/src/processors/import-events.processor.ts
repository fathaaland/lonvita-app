import type { Payload } from 'payload'

import { getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { ImportAiError } from '@/lib/import/ai'
import { isFullPass, isImportFileType, type SourceTrigger } from '@/lib/import/contracts'
import { ImportFetchError } from '@/lib/import/fetch'
import { defaultImportDeps, ImportReadError, loadImportContext, readUrl, storeCandidates, type ImportDeps } from '@/lib/import/pipeline'
import { deleteImportFile, downloadImportFile } from '@/lib/import/storage'
import { emptyTotals, isOverAiBudget, meterAi, type UsageTotals } from '@/lib/import/usage'
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

const messageOf = (error: unknown) => (isExpected(error) ? (error as Error).message : 'Zpracování se nepodařilo.')

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

/** Who looks after what a source brings: the obec's admins. */
async function ownersOf(payload: Payload, source: { municipality: unknown }) {
  return { userIds: await getMunicipalityAdminUserIds(payload, relationNumber(source.municipality)!), link: IMPORT_LINK }
}

async function processSource(
  payload: Payload,
  data: Extract<ImportEventsJobData, { kind: 'source' }>,
  deps: ImportDeps,
  context: DispatchContext,
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
    deps,
    payload,
    { municipality: municipalityId, user: requestedBy, eventSource: source.id, importRun: runId },
    { overBudget: await isOverAiBudget(payload, municipalityId, now), totals },
  )

  try {
    const read = await readUrl(
      source.url,
      // A full pass reads the page whether it changed or not.
      isFullPass(trigger)
        ? { aiContext: importContext.aiContext }
        : {
            previousHash: source.lastContentHash,
            aiContext: importContext.aiContext,
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
        consecutiveFailures: 0,
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
    await payload.update({
      collection: 'event-sources',
      id: source.id,
      data: {
        lastRunAt: runAt,
        lastError: messageOf(error),
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
      },
      overrideAccess: true,
    })
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
    { overBudget: await isOverAiBudget(payload, municipalityId, now), totals },
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
  const result =
    data.kind === 'source'
      ? await processSource(payload, data, deps, context)
      : await processManual(payload, data, deps, context, (context.attemptsMade ?? 0) + 1 >= (context.attempts ?? 3))
  logger.info('Events imported', { event: 'import.finished', kind: data.kind, jobId: context.jobId, ...result })
  return result
}
