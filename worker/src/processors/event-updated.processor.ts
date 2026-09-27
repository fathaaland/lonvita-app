import {
  DATE_FIELDS,
  NOTIFIABLE_EDIT_FIELDS,
  changedNotifiableFields,
  getEventRegistrants,
} from '@/collections/shared/eventNotifications'
import { escapeHtml, sendNotificationToMany, sendSmsToMany } from '@/collections/shared/notify'
import { rescheduleEventReminders } from '@/collections/shared/reminders'
import { formatPragueDateTime } from '@/lib/date'
import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { EventUpdatedJobData, EventUpdatedJobResult } from '@/lib/queue/contracts'

type DispatchContext = { jobId?: string }

const relId = (value: unknown): number | string =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

/**
 * "Akce byla upravena" for every registrant — in-app, e-mail and SMS. Runs a minute after the
 * first edit of a burst and diffs the event as it is now against that edit's starting point, so
 * a rolled-back edit, or one undone straight away, tells nobody anything.
 *
 * Only moving the reminders can fail the job (and retry it); delivery never throws, so a retry
 * can't announce the same edit twice.
 */
export const processEventUpdatedJob = async (
  data: EventUpdatedJobData,
  context: DispatchContext = {},
): Promise<EventUpdatedJobResult> => {
  const payload = await getWorkerPayload()

  const skip = (reason: string): EventUpdatedJobResult => {
    logger.info('Event update notification skipped', { event: 'event.update_skipped', eventId: data.eventId, reason })
    return { notified: 0, skipped: reason }
  }

  // find, not findByID: a missing event is a skip, but a database error has to fail the job.
  const found = await payload.find({
    collection: 'events',
    where: { id: { equals: data.eventId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const event = found.docs[0]
  if (!event) return skip('event_missing')
  // Cancelled since — the cancellation job tells everyone instead.
  if (event.deletedAt) return skip('event_cancelled')

  const changedFields = changedNotifiableFields(data.before, event as unknown as Record<string, unknown>)
  if (changedFields.length === 0) return skip('no_changes')

  if (changedFields.some((field) => DATE_FIELDS.has(field))) {
    await rescheduleEventReminders(payload, event)
  }

  const { userIds } = await getEventRegistrants(payload, event.id, relId(event.organizer))
  if (userIds.length === 0) return skip('no_registrants')

  const changedLabels = [...new Set(changedFields.map((field) => NOTIFIABLE_EDIT_FIELDS[field]))].join(', ')
  const when = formatPragueDateTime(event.dateTime)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const place = event.locationText.length > 60 ? `${event.locationText.slice(0, 57)}…` : event.locationText
  // Stable across retries of this job, unique to it — see sendSmsToMany.
  const announcementId = `event-updated-${event.id}-${context.jobId ?? Date.now()}`

  const sent = await sendNotificationToMany(
    payload,
    userIds,
    {
      title: 'Akce byla upravena',
      message: `Akce „${event.title}“, na kterou jste přihlášeni, byla upravena (změna: ${changedLabels}). Nově: ${when}, ${event.locationText}.`,
      link: `/akce/${event.id}`,
      email: {
        subject: `Akce upravena: ${event.title}`,
        body:
          `<p>Akce <strong>${escapeHtml(event.title)}</strong>, na kterou jste přihlášeni, byla upravena.</p>` +
          `<p>Změna: ${changedLabels}</p>` +
          `<p><strong>Kdy:</strong> ${when}<br/><strong>Kde:</strong> ${escapeHtml(event.locationText)}</p>` +
          `<p><a href="${appUrl}/akce/${event.id}">Zobrazit detail akce</a></p>`,
      },
    },
    { jobIdPrefix: announcementId },
  )
  const sms = await sendSmsToMany(
    payload,
    userIds,
    `Lonvita: akce „${event.title}“ byla upravena (${changedLabels}). Nově: ${when}, ${place}.`,
    announcementId,
  )

  logger.info('Event update announced', {
    event: 'event.update_notified',
    eventId: event.id,
    changedFields,
    registrants: userIds.length,
    inApp: sent.inApp,
    emails: sent.emails,
    sms,
  })
  return { notified: userIds.length }
}
