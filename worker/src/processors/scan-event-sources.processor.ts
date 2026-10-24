import { APP_TIME_ZONE } from '@/lib/date'
import { pragueToday } from '@/lib/import/time'
import { logger } from '@/lib/logger'
import { enqueueImportEvents } from '@/lib/queue/queues'

import { getWorkerPayload } from '../runtime/payload'

import type { ScanEventSourcesJobData, ScanEventSourcesJobResult } from '@/lib/queue/contracts'

/** Spread over the night rather than all at once — the AI and Nominatim are shared. */
const SPACING_MS = 15_000

/** The night to Monday is the weekly full pass. */
const isWeeklyNight = (now: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, weekday: 'short' }).format(now) === 'Mon'

/**
 * Each midnight one import-events job per enabled source — the nightly check (the AI only reads a
 * page that changed), or on the night to Monday the full pass. The job id carries the night, so a scheduler
 * firing twice (two workers, a restart) doesn't read a source twice.
 */
export const processScanEventSourcesJob = async (
  data: ScanEventSourcesJobData = {},
  now: Date = new Date(),
): Promise<ScanEventSourcesJobResult> => {
  const trigger = data.trigger ?? (isWeeklyNight(now) ? 'weekly' : 'daily')
  const payload = await getWorkerPayload()
  const sources = await payload.find({
    collection: 'event-sources',
    where: { enabled: { equals: true } },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const night = pragueToday(now)
  for (const [index, source] of sources.docs.entries()) {
    await enqueueImportEvents(
      { kind: 'source', sourceId: source.id, trigger },
      { jobId: `import-source-${source.id}-${night}`, delay: index * SPACING_MS },
    )
  }
  logger.info('Event sources queued', { event: 'import.sources_queued', trigger, count: sources.docs.length })
  return { queued: sources.docs.length }
}
