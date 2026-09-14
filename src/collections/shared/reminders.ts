import type { Payload } from 'payload'

import { enqueueEmail, getQueue } from '@/lib/queue/queues'

type RelId = number | { id: number }

type EventForReminders = {
  id: number | string
  title: string
  dateTime: string
  endDateTime?: string | null
  locationText?: string | null
  organizer: RelId
}

const relId = (value: RelId): number => (typeof value === 'object' ? value.id : value)

const attendanceJobId = (eventId: number | string) => `attendance-reminder-${eventId}`
const participantJobId = (registrationId: number | string) => `reminder-${registrationId}`

/** Delayed reminders are keyed by fixed job ids — BullMQ ignores an add whose id already exists,
 * so a rescheduled event must drop the old job first or it'd still fire at the old time. */
async function removeJob(jobId: string): Promise<void> {
  const job = await getQueue().getJob(jobId)
  if (job) await job.remove()
}

/** Brief §4/§7 "Po skončení akce organizátorovi přijde upozornění, že má vyplnit docházku." —
 * a delayed, email-only job (no in-app/preference check: it's a "did you remember to do X"
 * nudge, and the worker deliberately doesn't have Payload access to re-check attendance). */
export async function scheduleAttendanceReminder(payload: Payload, event: EventForReminders): Promise<void> {
  const organizer = await payload.findByID({
    collection: 'users',
    id: relId(event.organizer),
    depth: 0,
    overrideAccess: true,
  })
  if (!organizer?.email) return

  // A few hours' buffer after the event's own end time, so this doesn't land while it's
  // plausibly still running.
  const remindAt = new Date(event.endDateTime ?? event.dateTime).getTime() + 3 * 60 * 60 * 1000
  const delay = remindAt - Date.now()
  if (delay <= 0) return

  await enqueueEmail(
    {
      to: organizer.email,
      subject: `Nezapomeňte vyplnit docházku: ${event.title}`,
      body: `<p>Akce <strong>${event.title}</strong> proběhla — nezapomeňte prosím ve správě akce vyplnit docházku přihlášených.</p>`,
    },
    { jobId: attendanceJobId(event.id), delay },
  )
}

/** 24h-before reminder for an approved participant (brief §A5: "levné a užitečné"). Sent via the
 * raw email queue (not sendNotification) since it's timing-sensitive and should go out regardless
 * of the in-app preference; it still only fires for users who haven't opted out of email. */
export async function scheduleParticipantReminder(
  payload: Payload,
  registrationId: number | string,
  userId: number | string,
  event: EventForReminders,
): Promise<void> {
  const [profiles, user] = await Promise.all([
    payload.find({ collection: 'profiles', where: { user: { equals: userId } }, limit: 1, depth: 0, overrideAccess: true }),
    payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }),
  ])
  if (!user?.email || !(profiles.docs[0]?.notifyEmail ?? true)) return

  const delay = new Date(event.dateTime).getTime() - 24 * 60 * 60 * 1000 - Date.now()
  if (delay <= 0) return

  await enqueueEmail(
    {
      to: user.email,
      subject: `Připomínka: ${event.title} zítra`,
      body: `<p>Připomínáme, že zítra vás čeká akce <strong>${event.title}</strong> — ${event.locationText ?? ''}.</p>`,
    },
    { jobId: participantJobId(registrationId), delay },
  )
}

/** The event's start/end moved — re-plan the organizer's attendance nudge and every approved
 * participant's 24h reminder for the new time. */
export async function rescheduleEventReminders(payload: Payload, event: EventForReminders): Promise<void> {
  await removeJob(attendanceJobId(event.id))
  await scheduleAttendanceReminder(payload, event)

  const approved = await payload.find({
    collection: 'registrations',
    where: { and: [{ event: { equals: event.id } }, { status: { equals: 'approved' } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const reg of approved.docs) {
    await removeJob(participantJobId(reg.id))
    await scheduleParticipantReminder(payload, reg.id, relId(reg.user), event)
  }
}

/** The event was cancelled — nobody should get a reminder for it anymore. */
export async function cancelEventReminders(payload: Payload, eventId: number | string): Promise<void> {
  await removeJob(attendanceJobId(eventId))
  const registrations = await payload.find({
    collection: 'registrations',
    where: { event: { equals: eventId } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const reg of registrations.docs) {
    await removeJob(participantJobId(reg.id))
  }
}
