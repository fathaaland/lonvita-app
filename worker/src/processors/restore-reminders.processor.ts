import { restoreMissingReminders } from '@/collections/shared/reminders'
import { notDeleted } from '@/collections/shared/softDelete'
import { logger, serializeError } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { RestoreRemindersJobResult } from '@/lib/queue/contracts'

/** Only events this close need their jobs in Redis to be right — further out, a lost job is put back
 * by a later run all the same, well before its time. The 24h reminder fires within this window. */
const LOOK_AHEAD_MS = 9 * 24 * 60 * 60 * 1000
/** Ended this long ago, the attendance nudge (3 h after the end) is in the past either way. */
const LOOK_BACK_MS = 3 * 60 * 60 * 1000

/**
 * Every hour: the reminders of the coming days (the participants' 24h reminder by e-mail and SMS, the
 * organizer's attendance nudge) are delayed jobs in Redis and nowhere else — a Redis that restarted
 * without its data loses them. Whatever is missing but still ahead is put back (reminders
 * restoreMissingReminders), so nothing goes out twice. Enqueued only by the worker's own scheduler.
 */
export const processRestoreRemindersJob = async (now: Date = new Date()): Promise<RestoreRemindersJobResult> => {
  const payload = await getWorkerPayload()
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        notDeleted,
        { isDraft: { not_equals: true } },
        { status: { in: ['active', 'full', 'finished'] } },
        { dateTime: { less_than: new Date(now.getTime() + LOOK_AHEAD_MS).toISOString() } },
        {
          or: [
            { endDateTime: { greater_than: new Date(now.getTime() - LOOK_BACK_MS).toISOString() } },
            { dateTime: { greater_than: new Date(now.getTime() - LOOK_BACK_MS).toISOString() } },
          ],
        },
      ],
    },
    select: { title: true, dateTime: true, endDateTime: true, locationText: true, organizer: true, capacity: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  let restored = 0
  let failed = 0
  for (const event of events.docs) {
    try {
      const approved = await payload.find({
        collection: 'registrations',
        where: { and: [{ event: { equals: event.id } }, { status: { equals: 'approved' } }, notDeleted] },
        select: { user: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
      restored += await restoreMissingReminders(payload, event, approved.docs)
    } catch (error) {
      failed++
      logger.error('Reminders of an event not checked', { event: 'reminders.restore_failed', eventId: event.id, ...serializeError(error) })
    }
  }

  // Normally nothing: anything put back means Redis lost its jobs.
  logger[restored > 0 ? 'warn' : 'debug']('Reminders checked', {
    event: 'reminders.restore_finished',
    events: events.docs.length,
    restored,
    failed,
  })
  return { events: events.docs.length, restored, failed }
}
