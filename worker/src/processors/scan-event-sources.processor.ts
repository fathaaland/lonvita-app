import { APP_TIME_ZONE } from '@/lib/date'
import { pragueToday } from '@/lib/import/time'
import { logger } from '@/lib/logger'
import { enqueueImportEvents } from '@/lib/queue/queues'

import { getWorkerPayload } from '../runtime/payload'

import type { ScanEventSourcesJobData, ScanEventSourcesJobResult } from '@/lib/queue/contracts'

/** Spread out rather than all at once — the AI and Nominatim are shared. */
const SPACING_MS = 15_000

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** ISO weekday (1 = Monday) and hour of `now` in Prague. */
export function pragueSlotOf(now: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  return { day: WEEKDAYS.indexOf(weekday) + 1, hour }
}

type SlotFields = {
  scrapingSlotDay?: number | null
  scrapingSlotHour?: number | null
  scrapingFrequency?: string | null
}

/** Whether `now` is the obec's slot — its day and hour, and with twice a week also three days later. */
export function isObecSlot(m: SlotFields, now: Date): boolean {
  const { day, hour } = pragueSlotOf(now)
  const slotDay = m.scrapingSlotDay ?? 1
  if (hour !== (m.scrapingSlotHour ?? 2)) return false
  if (day === slotDay) return true
  return m.scrapingFrequency === 'twice_weekly' && day === ((slotDay + 2) % 7) + 1
}

/**
 * Every hour: the sources of each obec whose weekly slot this is (Balíčky služeb: "jednou týdně ve
 * slotu domluveném s obcí") — a full pass each. Only an obec that has scraping and isn't suspended;
 * the rest are read only when someone asks ("zkontrolovat teď"). The job id carries the day, so a
 * scheduler firing twice (two workers, a restart) doesn't read a source twice.
 */
export const processScanEventSourcesJob = async (
  _data: ScanEventSourcesJobData = {},
  now: Date = new Date(),
): Promise<ScanEventSourcesJobResult> => {
  const payload = await getWorkerPayload()
  const municipalities = await payload.find({
    collection: 'municipalities',
    where: {
      and: [{ importAiEnabled: { equals: true } }, { billingStatus: { not_equals: 'suspended' } }],
    },
    select: { scrapingSlotDay: true, scrapingSlotHour: true, scrapingFrequency: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const due = municipalities.docs.filter((m) => isObecSlot(m, now)).map((m) => m.id)
  if (due.length === 0) return { queued: 0 }

  const sources = await payload.find({
    collection: 'event-sources',
    where: { and: [{ enabled: { equals: true } }, { municipality: { in: due } }] },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const day = pragueToday(now)
  for (const [index, source] of sources.docs.entries()) {
    await enqueueImportEvents(
      { kind: 'source', sourceId: source.id, trigger: 'weekly' },
      { jobId: `import-source-${source.id}-${day}`, delay: index * SPACING_MS },
    )
  }
  logger.info('Event sources queued', { event: 'import.sources_queued', obce: due.length, count: sources.docs.length })
  return { queued: sources.docs.length }
}
