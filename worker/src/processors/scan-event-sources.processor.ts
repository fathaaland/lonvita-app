import { APP_TIME_ZONE } from '@/lib/date'
import { pragueToday } from '@/lib/import/time'
import { logger } from '@/lib/logger'
import { enqueueImportEvents } from '@/lib/queue/queues'
import { sourcesWithinPackage } from '@/lib/billing/scraping'

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

/** Past its slot by this much with no read, a source's slot counts as missed (the worker was down). */
const SLOT_GRACE_MS = 3 * 60 * 60 * 1000
/** How many missed sources one hourly run catches up — a week-long outage drains over a few hours. */
const CATCH_UP_PER_RUN = 20
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Sources whose slot went by unread — the worker asleep or down that hour, so the slot is gone until
 * next week. One read longer ago than its interval (a week; with twice a week, the longer of the two
 * gaps, four days) plus a few hours is queued now, the longest-waiting first. Any read counts — a
 * failed one or "zkontrolovat teď" too —, and one already queued or running is left alone.
 */
async function overdueSources(
  payload: Awaited<ReturnType<typeof getWorkerPayload>>,
  municipalities: ({ id: number } & SlotFields)[],
  now: Date,
): Promise<number[]> {
  const out: number[] = []
  for (const interval of [7 * DAY_MS, 4 * DAY_MS]) {
    const obce = municipalities
      .filter((m) => (interval === 4 * DAY_MS) === (m.scrapingFrequency === 'twice_weekly'))
      .map((m) => m.id)
    if (obce.length === 0) continue
    const before = new Date(now.getTime() - interval - SLOT_GRACE_MS).toISOString()
    const stale = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
    const overdue = await payload.find({
      collection: 'event-sources',
      where: {
        and: [
          { enabled: { equals: true } },
          { municipality: { in: obce } },
          { or: [{ lastRunAt: { less_than: before } }, { and: [{ lastRunAt: { exists: false } }, { createdAt: { less_than: before } }] }] },
          // Queued or running — unless that mark is hours old (a worker that crashed mid-read).
          { or: [{ queuedAt: { exists: false } }, { queuedAt: { less_than: stale } }] },
          { or: [{ runningSince: { exists: false } }, { runningSince: { less_than: stale } }] },
        ],
      },
      select: {},
      sort: 'lastRunAt',
      limit: CATCH_UP_PER_RUN - out.length,
      depth: 0,
      overrideAccess: true,
    })
    out.push(...overdue.docs.map((d) => d.id))
    if (out.length >= CATCH_UP_PER_RUN) break
  }
  return out
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
  const caughtUp = await overdueSources(payload, municipalities.docs, now)
  if (due.length === 0 && caughtUp.length === 0) return { queued: 0 }

  const inSlot =
    due.length === 0
      ? { docs: [] as { id: number }[] }
      : await payload.find({
    collection: 'event-sources',
    where: { and: [{ enabled: { equals: true } }, { municipality: { in: due } }] },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  // Only what each obec's package covers — after a smaller package more may still be switched on.
  const covered = new Set<number>()
  for (const m of municipalities.docs) {
    for (const id of await sourcesWithinPackage(payload, m.id)) covered.add(id)
  }
  const sources = {
    docs: [...inSlot.docs, ...caughtUp.filter((id) => !inSlot.docs.some((d) => d.id === id)).map((id) => ({ id }))].filter(
      (d) => covered.has(d.id),
    ),
  }
  if (caughtUp.length > 0) {
    logger.warn('Event sources caught up after a missed slot', { event: 'import.sources_caught_up', count: caughtUp.length })
  }
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
