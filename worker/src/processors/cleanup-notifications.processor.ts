import { logger } from '@/lib/logger'
import { daysBefore, RETENTION } from '@/lib/retention/policy'

import { BATCH_SIZE, inBatches } from '../runtime/batches'
import { getWorkerPayload } from '../runtime/payload'

import type { CleanupNotificationsJobResult } from '@/lib/queue/contracts'
import type { Payload } from 'payload'
import type { Where } from 'payload'

const daysAgo = (days: number): string => daysBefore(new Date(), days).toISOString()

/** Age is measured from `createdAt`, not from when it was read — this is "throw away old
 * notifications", so a notification read the day it arrived and one read months later expire
 * together. */
const expiredNotifications = (): Where => ({
  or: [
    {
      and: [{ readAt: { exists: true } }, { createdAt: { less_than: daysAgo(RETENTION.notificationReadDays) } }],
    },
    { createdAt: { less_than: daysAgo(RETENTION.notificationDays) } },
  ],
})

export const processCleanupNotificationsJob = async (): Promise<CleanupNotificationsJobResult> => {
  const payload: Payload = await getWorkerPayload()
  const where = expiredNotifications()

  const deleted = await inBatches(async () => {
    const expired = await payload.find({
      collection: 'notifications',
      where,
      depth: 0,
      limit: BATCH_SIZE,
      pagination: false,
      overrideAccess: true,
    })
    if (expired.docs.length === 0) return 0

    // Notifications.access.delete is closed to everyone, this job included — overrideAccess is
    // what makes retention the one path allowed to remove them.
    await payload.delete({
      collection: 'notifications',
      where: { id: { in: expired.docs.map((doc) => doc.id) } },
      overrideAccess: true,
    })
    return expired.docs.length
  })

  logger.info('Notification cleanup finished', {
    event: 'notifications.cleanup_finished',
    deleted,
    readRetentionDays: RETENTION.notificationReadDays,
    retentionDays: RETENTION.notificationDays,
  })

  return { deleted }
}
