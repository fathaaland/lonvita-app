import type { Payload } from 'payload'

import { getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { ImportAiError } from '@/lib/import/ai'
import { ImportFetchError } from '@/lib/import/fetch'
import { defaultImportDeps, ImportReadError, loadImportContext, readUrl, storeCandidates, type ImportDeps } from '@/lib/import/pipeline'
import { deleteImportFile, downloadImportFile } from '@/lib/import/storage'
import { isImportFileType } from '@/lib/import/contracts'
import { logger, serializeError } from '@/lib/logger'
import { relationId } from '@/lib/relations'

import { getWorkerPayload } from '../runtime/payload'

import type { ImportEventsJobData, ImportEventsJobResult } from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
  /** Attempts the job has in total (queue options) — the last one cleans up after itself. */
  attempts?: number
}

const IMPORT_LINK = '/admin-obce?tab=import'

/** A failure the source or the input causes — said to the admin, not retried. */
const isExpected = (error: unknown) =>
  error instanceof ImportFetchError || error instanceof ImportAiError || error instanceof ImportReadError

const messageOf = (error: unknown) => (isExpected(error) ? (error as Error).message : 'Zpracování se nepodařilo.')

const countLabel = (n: number) => (n === 1 ? '1 novou akci' : n >= 2 && n <= 4 ? `${n} nové akce` : `${n} nových akcí`)

async function processSource(
  payload: Payload,
  sourceId: number | string,
  deps: ImportDeps,
): Promise<ImportEventsJobResult> {
  const source = await payload
    .findByID({ collection: 'event-sources', id: sourceId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!source || !source.enabled) return { found: 0, created: 0, updated: 0, skipped: 'source_gone_or_disabled' }
  const context = await loadImportContext(payload, relationId(source.municipality)!)
  if (!context) return { found: 0, created: 0, updated: 0, skipped: 'municipality_gone' }

  const runAt = deps.now().toISOString()
  try {
    const read = await readUrl(source.url, { previousHash: source.lastContentHash, aiContext: context.aiContext }, deps)
    const stored = read.unchanged
      ? { created: 0, updated: 0, createdIds: [] }
      : await storeCandidates(
          payload,
          {
            municipality: context.municipality,
            events: read.events,
            origin: 'source',
            originLabel: source.url,
            sourceId: source.id,
            requestedBy: null,
          },
          deps,
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
        ...(read.unchanged ? {} : { lastFoundCount: read.events.length }),
      },
      overrideAccess: true,
    })
    if (stored.created > 0) {
      const admins = await getMunicipalityAdminUserIds(payload, context.municipality.id)
      await sendNotificationToMany(payload, admins, {
        title: 'Nové akce k převzetí',
        link: IMPORT_LINK,
        message: `Na webu ${source.label || source.url} jsme našli ${countLabel(stored.created)}. Zkontrolujte je a převezměte v Přehledu obce v sekci Import.`,
      })
    }
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
  isLastAttempt: boolean,
): Promise<ImportEventsJobResult> {
  const what = data.kind === 'text' ? 've vloženém textu' : `v souboru „${data.fileName}“`
  const notify = (title: string, message: string, link?: string) =>
    sendNotificationToMany(payload, [data.requestedBy], { title, message, link })

  const context = await loadImportContext(payload, data.municipalityId)
  if (!context) return { found: 0, created: 0, updated: 0, skipped: 'municipality_gone' }

  let succeeded = false
  try {
    if (!deps.aiAvailable()) throw new ImportReadError('AI čtení není zapnuté — import z textu a souborů teď nejde.')
    const events =
      data.kind === 'text'
        ? await deps.extractWithAi({ kind: 'text', text: data.text, sourceUrl: null }, context.aiContext)
        : isImportFileType(data.mimeType)
          ? await deps.extractWithAi(
              { kind: 'file', data: await downloadImportFile(data.fileKey), mimeType: data.mimeType, fileName: data.fileName },
              context.aiContext,
            )
          : []
    const stored = await storeCandidates(
      payload,
      {
        municipality: context.municipality,
        events,
        origin: data.kind,
        originLabel: data.kind === 'file' ? data.fileName : null,
        sourceId: null,
        requestedBy: Number(data.requestedBy),
      },
      deps,
    )
    succeeded = true
    if (stored.created > 0) {
      await notify('Nové akce k převzetí', `${what[0].toUpperCase()}${what.slice(1)} jsme našli ${countLabel(stored.created)}. Zkontrolujte je a převezměte v sekci Import.`, IMPORT_LINK)
    } else {
      await notify('Import nenašel nové akce', `${what[0].toUpperCase()}${what.slice(1)} jsme nenašli žádné nové nadcházející akce.`, IMPORT_LINK)
    }
    return { found: events.length, created: stored.created, updated: stored.updated }
  } catch (error) {
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
 * Reads one input into EventImportCandidates (lib/import/pipeline). A source's outcome is written on
 * the source (the obec's admin sees it next to it), and its admins hear about new events; a pasted
 * program or file is answered to whoever sent it. What the source or the input causes — unreachable,
 * forbidden by robots.txt, unreadable — isn't retried; anything else is, by the queue.
 */
export const processImportEventsJob = async (
  data: ImportEventsJobData,
  context: DispatchContext = {},
  deps: ImportDeps = defaultImportDeps(),
): Promise<ImportEventsJobResult> => {
  const payload = await getWorkerPayload()
  const result =
    data.kind === 'source'
      ? await processSource(payload, data.sourceId, deps)
      : await processManual(payload, data, deps, (context.attemptsMade ?? 0) + 1 >= (context.attempts ?? 3))
  logger.info('Events imported', { event: 'import.finished', kind: data.kind, jobId: context.jobId, ...result })
  return result
}
