import { SOURCE_SCAN_INTERVAL_HOURS } from '@/lib/import/contracts'
import { logger } from '@/lib/logger'
import { enqueueImportEvents } from '@/lib/queue/queues'

import { getWorkerPayload } from '../runtime/payload'

import type { ScanEventSourcesJobResult } from '@/lib/queue/contracts'

/**
 * Every SOURCE_SCAN_INTERVAL_HOURS: one import-events job per enabled source. The job id carries the
 * slot, so a scheduler firing twice (two workers, a restart) doesn't read a source twice in a row.
 */
export const processScanEventSourcesJob = async (now: Date = new Date()): Promise<ScanEventSourcesJobResult> => {
  const payload = await getWorkerPayload()
  const sources = await payload.find({
    collection: 'event-sources',
    where: { enabled: { equals: true } },
    select: { municipality: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const slot = Math.floor(now.getTime() / (SOURCE_SCAN_INTERVAL_HOURS * 60 * 60 * 1000))
  for (const [index, source] of sources.docs.entries()) {
    // Spread over a few minutes rather than all at once — the AI and Nominatim are shared.
    await enqueueImportEvents(
      { kind: 'source', sourceId: source.id },
      { jobId: `import-source-${source.id}-${slot}`, delay: index * 20_000 },
    )
  }
  logger.info('Event sources queued', { event: 'import.sources_queued', count: sources.docs.length })
  return { queued: sources.docs.length }
}
