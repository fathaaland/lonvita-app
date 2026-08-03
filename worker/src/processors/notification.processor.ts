import { logger } from '@/lib/logger'

import type { NotificationJobData } from '@/lib/queue/contracts'

type QueueJobContext = {
  jobId?: string
}

// Stub — no in-app Notifications collection or push-delivery channel exists yet.
// Wire this up to a real collection/channel when one is added.
export const processNotificationJob = async (
  payload: NotificationJobData,
  context?: QueueJobContext,
): Promise<void> => {
  const { userId, type, title } = payload

  logger.info('[NotificationWorker] Processing job', {
    jobId: context?.jobId,
    userId,
    type,
    title,
  })
}
