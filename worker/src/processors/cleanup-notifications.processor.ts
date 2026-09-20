import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { CleanupNotificationsJobResult } from '@/lib/queue/contracts'
import type { Payload } from 'payload'
import type { Where } from 'payload'

/** Once someone has read a notification it's history — a month is plenty to find it again. */
const READ_RETENTION_DAYS = 30
/** Unread ones get longer, so nobody loses a notification they haven't even seen yet. Past this
 * the notification is about something months gone, and the event it points at may not exist. */
const RETENTION_DAYS = 90

/** Deleted in bounded batches rather than one open-ended statement: a backlog that built up over
 * months shouldn't turn into a single huge delete that outlives the job's lock. */
const BATCH_SIZE = 500
/** A stop so a runaway loop can't spin forever — 100 full batches is far past any real backlog,
 * and whatever is left gets picked up by the next nightly run. */
const MAX_BATCHES = 100

const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

/** Age is measured from `createdAt`, not from when it was read — this is "throw away old
 * notifications", so a notification read the day it arrived and one read months later expire
 * together. */
const expiredNotifications = (): Where => ({
  or: [
    {
      and: [{ readAt: { exists: true } }, { createdAt: { less_than: daysAgo(READ_RETENTION_DAYS) } }],
    },
    { createdAt: { less_than: daysAgo(RETENTION_DAYS) } },
  ],
})

export const processCleanupNotificationsJob = async (): Promise<CleanupNotificationsJobResult> => {
  const payload: Payload = await getWorkerPayload()
  const where = expiredNotifications()

  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const expired = await payload.find({
      collection: 'notifications',
      where,
      depth: 0,
      limit: BATCH_SIZE,
      pagination: false,
      overrideAccess: true,
    })
    if (expired.docs.length === 0) break

    // Notifications.access.delete is closed to everyone, this job included — overrideAccess is
    // what makes retention the one path allowed to remove them.
    await payload.delete({
      collection: 'notifications',
      where: { id: { in: expired.docs.map((doc) => doc.id) } },
      overrideAccess: true,
    })
    deleted += expired.docs.length

    if (expired.docs.length < BATCH_SIZE) break
  }

  logger.info('[CleanupNotifications] Finished', {
    deleted,
    readRetentionDays: READ_RETENTION_DAYS,
    retentionDays: RETENTION_DAYS,
  })

  return { deleted }
}
