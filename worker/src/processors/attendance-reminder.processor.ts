import { escapeHtml } from '@/collections/shared/notify'
import { isUnlimitedCapacity } from '@/lib/capacity'
import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'
import { processEmailJob } from './email.processor'

import type { AttendanceReminderJobData, AttendanceReminderJobResult } from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
}

const relId = (value: unknown): number | string =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

/**
 * E-mails the organizer the "vyplňte docházku" nudge scheduled by `scheduleAttendanceReminder` —
 * unless, by the time it fires, there's nothing to fill in: the event was cancelled or deleted,
 * moved later (a fresh job exists for the new time), it has unlimited capacity (no attendance is kept
 * there), nobody was approved for it, or the organizer already marked every approved participant.
 * Email-only on purpose: it's a "did you remember" nudge, not something to keep in the in-app list.
 */
export const processAttendanceReminderJob = async (
  data: AttendanceReminderJobData,
  context: DispatchContext = {},
): Promise<AttendanceReminderJobResult> => {
  const payload = await getWorkerPayload()
  const skip = (reason: string): AttendanceReminderJobResult => {
    logger.info('Attendance reminder skipped', { event: 'attendance_reminder.skipped', eventId: data.eventId, reason })
    return { sent: false, skipped: reason }
  }

  const event = await payload
    .findByID({ collection: 'events', id: data.eventId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') return skip('event_gone')
  if (new Date(event.endDateTime ?? event.dateTime).getTime() > Date.now()) return skip('event_not_over')
  // Checked when it fires, not when it's queued — the capacity may change in between.
  if (isUnlimitedCapacity(event.capacity)) return skip('unlimited_capacity')

  const [approved, unmarked] = await Promise.all([
    payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: event.id } }, { status: { equals: 'approved' } }] },
      overrideAccess: true,
    }),
    payload.count({
      collection: 'registrations',
      where: {
        and: [
          { event: { equals: event.id } },
          { status: { equals: 'approved' } },
          { attendanceStatus: { equals: 'not_marked' } },
        ],
      },
      overrideAccess: true,
    }),
  ])
  if (approved.totalDocs === 0) return skip('no_participants')
  if (unmarked.totalDocs === 0) return skip('already_marked')

  const organizer = await payload
    .findByID({ collection: 'users', id: relId(event.organizer), depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!organizer?.email) return skip('organizer_without_email')

  const title = escapeHtml(event.title)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const { messageId } = await processEmailJob(
    {
      to: organizer.email,
      subject: `Nezapomeňte vyplnit docházku: ${event.title}`,
      body:
        `<p>Akce <strong>${title}</strong> proběhla — nezapomeňte prosím ve správě akce vyplnit docházku přihlášených ` +
        `(zbývá ${unmarked.totalDocs} z ${approved.totalDocs}).</p>` +
        (appUrl ? `<p><a href="${appUrl}/spravovat/${event.id}">Vyplnit docházku</a></p>` : ''),
    },
    context,
  )

  logger.info('Attendance reminder sent', {
    event: 'attendance_reminder.sent',
    eventId: event.id,
    unmarked: unmarked.totalDocs,
    jobId: context.jobId,
    messageId,
  })
  return { sent: true, messageId }
}
