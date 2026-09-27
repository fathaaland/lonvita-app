import { escapeHtml, sendNotificationToMany, sendSmsToMany } from '@/collections/shared/notify'
import { cancelEventReminders } from '@/collections/shared/reminders'
import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { EventCancelledJobData, EventCancelledJobResult } from '@/lib/queue/contracts'

type DispatchContext = { jobId?: string }

/**
 * "Akce byla zrušena" for every registrant — in-app, e-mail and SMS — and none of the event's
 * reminders go out anymore. Works from the snapshot in the job: a consented delete has removed
 * the event and its registrations by now. An event that's still there and not cancelled means
 * the cancel rolled back (or was undone) — then nobody hears anything.
 */
export const processEventCancelledJob = async (
  data: EventCancelledJobData,
  context: DispatchContext = {},
): Promise<EventCancelledJobResult> => {
  const payload = await getWorkerPayload()

  // find, not findByID: "gone" is the hard-delete case, but a database error has to fail the job.
  const found = await payload.find({
    collection: 'events',
    where: { id: { equals: data.eventId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const event = found.docs[0]
  if (event && !event.deletedAt) {
    logger.info('Event cancellation notification skipped', {
      event: 'event.cancel_skipped',
      eventId: data.eventId,
      reason: 'not_cancelled',
    })
    return { notified: 0, skipped: 'not_cancelled' }
  }

  // First, and the only step that can fail the job — so a retry never re-announces.
  await cancelEventReminders(data.eventId, data.registrationIds)

  const announcementId = `event-cancelled-${data.eventId}-${context.jobId ?? Date.now()}`
  const sent = await sendNotificationToMany(
    payload,
    data.userIds,
    {
      title: 'Akce byla zrušena',
      message: `Akce „${data.title}“, na kterou jste byli přihlášeni, byla zrušena.`,
      email: {
        subject: `Akce zrušena: ${data.title}`,
        body: `<p>Akce <strong>${escapeHtml(data.title)}</strong>, na kterou jste byli přihlášeni, byla zrušena.</p>`,
      },
    },
    { jobIdPrefix: announcementId },
  )
  const sms = await sendSmsToMany(
    payload,
    data.userIds,
    `Lonvita: akce „${data.title}“ byla zrušena.`,
    announcementId,
  )

  logger.info('Event cancellation announced', {
    event: 'event.cancel_notified',
    eventId: data.eventId,
    registrants: data.userIds.length,
    inApp: sent.inApp,
    emails: sent.emails,
    sms,
  })
  return { notified: data.userIds.length }
}
