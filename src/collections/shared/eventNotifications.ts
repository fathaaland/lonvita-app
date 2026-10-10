import type { Payload } from 'payload'

import { enqueueEventCancelled, enqueueEventUpdated } from '@/lib/queue/queues'

/** Brief §7 "Úprava existující akce → všichni přihlášení účastníci" — every field a participant
 * can see on the event, with the (Czech) label used to tell them what changed. Routine internal
 * writes (e.g. the isVolunteering guard, a photo swap) don't notify anyone. */
export const NOTIFIABLE_EDIT_FIELDS: Record<string, string> = {
  title: 'název',
  dateTime: 'začátek',
  endDateTime: 'konec',
  recurrenceRule: 'opakování',
  locationText: 'místo konání',
  lat: 'místo konání',
  lng: 'místo konání',
  description: 'popis',
  capacity: 'kapacita',
  registrationApprovalMode: 'způsob přihlašování',
  accessibilityTags: 'přístupnost',
  categories: 'kategorie',
  isPaid: 'cena',
  priceCents: 'cena',
}

export const DATE_FIELDS = new Set(['dateTime', 'endDateTime'])

/** Comparable form of a field value — relationship ids instead of populated docs, sorted
 * arrays, and timestamps for dates (the same instant can come back formatted differently). */
export function comparable(field: string, value: unknown): string {
  const idOf = (v: unknown) => (v && typeof v === 'object' && 'id' in v ? (v as { id: unknown }).id : v)
  if (value === undefined || value === null || value === '') return 'null'
  if (DATE_FIELDS.has(field)) return String(new Date(value as string).getTime())
  if (Array.isArray(value)) return JSON.stringify(value.map(idOf).map(String).sort())
  return JSON.stringify(idOf(value))
}

/** The notifiable fields of `doc` in comparable form — what the edit job diffs against later. */
export const snapshotNotifiableFields = (doc: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.keys(NOTIFIABLE_EDIT_FIELDS).map((field) => [field, comparable(field, doc[field])]))

export const changedNotifiableFields = (before: Record<string, string>, doc: Record<string, unknown>): string[] =>
  Object.keys(NOTIFIABLE_EDIT_FIELDS).filter((field) => before[field] !== comparable(field, doc[field]))

/** Everyone an announcement about the event concerns: the pending/approved registrants to tell
 * (the organizer excluded), every registration, whose reminder jobs a cancellation drops, and the
 * volunteers whose invitation or offer is still waiting on it. */
export async function getEventRegistrants(
  payload: Payload,
  eventId: number | string,
  organizerId: number | string,
): Promise<{
  userIds: (number | string)[]
  registrationIds: (number | string)[]
  volunteerUserIds: (number | string)[]
}> {
  const regs = await payload.find({
    collection: 'registrations',
    where: { event: { equals: eventId } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const userIds = regs.docs
    .filter((reg) => reg.status === 'pending' || reg.status === 'approved')
    .map((reg) => (typeof reg.user === 'object' ? reg.user.id : reg.user))
    .filter((userId) => String(userId) !== String(organizerId))
  const waiting = await payload.find({
    collection: 'volunteer-invitations',
    where: { and: [{ event: { equals: eventId } }, { status: { equals: 'pending' } }] },
    select: { volunteer: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const registrantIds = new Set(userIds.map(String))
  const volunteerUserIds = waiting.docs
    .map((inv) => (typeof inv.volunteer === 'object' ? inv.volunteer.id : inv.volunteer))
    .filter((userId) => !registrantIds.has(String(userId)))
  return {
    userIds: [...new Set(userIds)],
    registrationIds: regs.docs.map((reg) => reg.id),
    volunteerUserIds: [...new Set(volunteerUserIds)],
  }
}

/**
 * Hands the "akce upravena" announcement to the worker — the registrants can be hundreds, and
 * each one is a notification row and an e-mail. Only the pre-edit snapshot travels: the
 * worker reads the event once the edit has committed (and any quick follow-up edits with it).
 */
export async function queueEventUpdatedNotification(
  eventId: number | string,
  previousDoc: Record<string, unknown>,
): Promise<void> {
  await enqueueEventUpdated({ eventId, before: snapshotNotifiableFields(previousDoc) })
}

/**
 * Tells the registrants the event is off — in-app, e-mail and SMS — and drops its queued
 * reminders, in the worker. Shared by the cancel hook and the co-organizers' consented hard
 * delete (api/events/deletion-requests), which has to collect the registrants before deleting
 * them. `delay` gives an in-transaction caller's write time to commit before the worker checks.
 */
export async function notifyEventCancelled(
  payload: Payload,
  event: { id: number | string; title: string; organizer: number | { id: number } },
  options?: { delay?: number; registrants?: Awaited<ReturnType<typeof getEventRegistrants>> },
): Promise<void> {
  const organizerId = typeof event.organizer === 'object' ? event.organizer.id : event.organizer
  const registrants = options?.registrants ?? (await getEventRegistrants(payload, event.id, organizerId))
  // No fixed job id: a cancel that rolled back leaves a job behind (it skips), and a fixed id
  // would swallow the retried cancel's own.
  await enqueueEventCancelled({ eventId: event.id, title: event.title, ...registrants }, { delay: options?.delay })
}
