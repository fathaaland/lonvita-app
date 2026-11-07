import type { Payload } from 'payload'

import { isUnlimitedCapacity } from '@/lib/capacity'

import {
  enqueueAttendanceReminder,
  enqueueEmail,
  enqueueFeedbackRequest,
  enqueueReminderSms,
  getEmailQueue,
  getQueue,
} from '@/lib/queue/queues'
import { requiredRelationNumber } from '@/lib/relations'

import { escapeHtml } from './notify'

type RelId = number | { id: number }

type EventForReminders = {
  id: number | string
  title: string
  dateTime: string
  endDateTime?: string | null
  locationText?: string | null
  organizer: RelId
  capacity: number
}

const attendanceJobId = (eventId: number | string) => `attendance-reminder-${eventId}`
const participantJobId = (registrationId: number | string) => `reminder-${registrationId}`
const participantSmsJobId = (registrationId: number | string) => `reminder-sms-${registrationId}`
/** Keyed by the end time too: a rescheduled event gets a fresh job at the new time, and the old
 * one — which BullMQ would otherwise keep in place of it — finds the event not over yet and skips. */
const feedbackJobId = (registrationId: number | string, endsAt: number) => `feedback-request-${registrationId}-${endsAt}`

/** Delayed reminders are keyed by fixed job ids — BullMQ ignores an add whose id already exists,
 * so a rescheduled event must drop the old job first or it'd still fire at the old time. */
async function removeJob(jobId: string, queue = getQueue()): Promise<void> {
  const job = await queue.getJob(jobId)
  if (job) await job.remove()
}

/** The 24h e-mail reminder waits in the e-mail queue — and, queued before that queue existed, maybe
 * still in the main one. */
async function removeParticipantReminder(registrationId: number | string): Promise<void> {
  await removeJob(participantJobId(registrationId), getEmailQueue())
  await removeJob(participantJobId(registrationId))
}

/** Brief §4/§7 "Po skončení akce organizátorovi přijde upozornění, že má vyplnit docházku." —
 * only the event id is queued; the worker looks up the organizer when it fires and skips the
 * nudge if attendance no longer needs filling in (see attendance-reminder.processor). */
export async function scheduleAttendanceReminder(
  event: Pick<EventForReminders, 'id' | 'dateTime' | 'endDateTime'>,
): Promise<void> {
  // A few hours' buffer after the event's own end time, so this doesn't land while it's
  // plausibly still running.
  const remindAt = new Date(event.endDateTime ?? event.dateTime).getTime() + 3 * 60 * 60 * 1000
  const delay = remindAt - Date.now()
  if (delay <= 0) return

  await enqueueAttendanceReminder({ eventId: event.id }, { jobId: attendanceJobId(event.id), delay })
}

/** 24h-before reminder for an approved participant (brief §A5: "levné a užitečné"). Sent via the
 * raw email queue (not sendNotification) since it's timing-sensitive and should go out regardless
 * of the in-app preference; it still only fires for users who haven't opted out of email. */
export async function scheduleParticipantReminder(
  payload: Payload,
  registrationId: number | string,
  userId: number | string,
  event: EventForReminders,
): Promise<number> {
  let queued = 0
  const [profiles, user] = await Promise.all([
    payload.find({ collection: 'profiles', where: { user: { equals: userId } }, limit: 1, depth: 0, overrideAccess: true }),
    payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }),
  ])
  const delay = new Date(event.dateTime).getTime() - 24 * 60 * 60 * 1000 - Date.now()
  if (delay <= 0) return queued

  // By SMS too for whoever chose it — the worker checks the obec's package, its quota and the
  // event's size when it fires (reminder-sms.processor).
  const profile = profiles.docs[0]
  if (profile?.notifySms && profile.phone) {
    await enqueueReminderSms({ registrationId }, { jobId: participantSmsJobId(registrationId), delay })
    queued++
  }

  if (!user?.email || !(profile?.notifyEmail ?? true)) return queued

  await enqueueEmail(
    {
      to: user.email,
      subject: `Připomínka: ${event.title} zítra`,
      body: `<p>Připomínáme, že zítra vás čeká akce <strong>${escapeHtml(event.title)}</strong> — ${escapeHtml(event.locationText ?? '')}.</p>`,
    },
    { jobId: participantJobId(registrationId), delay },
  )
  return queued + 1
}

/** They're no longer coming (taken off the event, or cancelled themselves) — no reminder for it. */
export async function cancelParticipantReminder(registrationId: number | string): Promise<void> {
  await removeParticipantReminder(registrationId)
  await removeJob(participantSmsJobId(registrationId))
}

/** US-U-03 — ask a participant the organizer confirmed as attended to rate the event. Goes out as
 * soon as attendance is confirmed, or when the event ends if that's confirmed while it's still on.
 * The worker re-checks everything when it fires. */
export async function scheduleFeedbackRequest(
  registrationId: number | string,
  event: Pick<EventForReminders, 'dateTime' | 'endDateTime'>,
): Promise<void> {
  const endsAt = new Date(event.endDateTime ?? event.dateTime).getTime()
  if (Number.isNaN(endsAt)) return
  const delay = Math.max(0, endsAt - Date.now())
  // A job still waiting under this id would swallow the new one — re-plan it from now instead.
  await removeJob(feedbackJobId(registrationId, endsAt))
  await enqueueFeedbackRequest({ registrationId }, { jobId: feedbackJobId(registrationId, endsAt), delay })
}

/** The event's start/end moved — re-plan the organizer's attendance nudge, every approved
 * participant's 24h reminder and any pending feedback prompt for the new time. */
export async function rescheduleEventReminders(payload: Payload, event: EventForReminders): Promise<void> {
  await removeJob(attendanceJobId(event.id))
  await scheduleAttendanceReminder(event)

  const approved = await payload.find({
    collection: 'registrations',
    where: { and: [{ event: { equals: event.id } }, { status: { equals: 'approved' } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const reg of approved.docs) {
    await removeParticipantReminder(reg.id)
    await removeJob(participantSmsJobId(reg.id))
    await scheduleParticipantReminder(payload, reg.id, requiredRelationNumber(reg.user), event)
    if (reg.attendanceStatus === 'attended' || isUnlimitedCapacity(event.capacity)) {
      await scheduleFeedbackRequest(reg.id, event)
    }
  }
}

/** The event was cancelled — nobody should get a reminder for it anymore. Takes the registration
 * ids rather than looking them up: after a consented hard delete the registrations are gone. */
export async function cancelEventReminders(
  eventId: number | string,
  registrationIds: (number | string)[],
): Promise<void> {
  await removeJob(attendanceJobId(eventId))
  for (const registrationId of registrationIds) {
    await removeParticipantReminder(registrationId)
    await removeJob(participantSmsJobId(registrationId))
  }
}

/** Whether a job is still waiting in Redis under its id. */
async function hasJob(jobId: string, queue = getQueue()): Promise<boolean> {
  return Boolean(await queue.getJob(jobId))
}

/**
 * The delayed reminders live only in Redis — lost with it (a restart without persistence, a flush),
 * they'd never go out. For an approved participant whose reminder time is still ahead, and an event
 * whose attendance nudge is: put back what's missing, under the same job id. Only what's still ahead:
 * a reminder whose time hasn't come can't have been sent, so putting it back never sends one twice.
 * Returns how many were put back.
 */
export async function restoreMissingReminders(
  payload: Payload,
  event: EventForReminders,
  approved: { id: number | string; user: RelId }[],
): Promise<number> {
  let restored = 0
  const remindAt = new Date(event.endDateTime ?? event.dateTime).getTime() + 3 * 60 * 60 * 1000
  if (remindAt > Date.now() && !(await hasJob(attendanceJobId(event.id)))) {
    await scheduleAttendanceReminder(event)
    restored++
  }
  if (new Date(event.dateTime).getTime() - 24 * 60 * 60 * 1000 <= Date.now()) return restored
  for (const reg of approved) {
    const present =
      (await hasJob(participantJobId(reg.id), getEmailQueue())) ||
      (await hasJob(participantJobId(reg.id))) ||
      (await hasJob(participantSmsJobId(reg.id)))
    if (present) continue
    // Adds under fixed ids — whichever of the two is still there stays as it is. Someone who wants
    // neither (no e-mail, no SMS) gets nothing, as when it was first planned.
    if ((await scheduleParticipantReminder(payload, reg.id, requiredRelationNumber(reg.user), event)) > 0) restored++
  }
  return restored
}
