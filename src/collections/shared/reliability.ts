import type { Payload, PayloadRequest } from 'payload'

import {
  EMPTY_RELIABILITY,
  reliabilityWindowStart,
  summarizeReliability,
  type ReliabilityEntry,
  type ReliabilityRecord,
} from '@/lib/reliability'

const relId = (value: unknown): string =>
  String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * The participants' reliability (lib/reliability), by user id — everyone asked for gets a record.
 * Each outcome is dated by its event's start, so a correction later on doesn't move it in time.
 * Pass the `req` of a transaction that may have just marked one.
 */
export async function loadReliability(
  payload: Payload,
  userIds: (number | string)[],
  { req, now = new Date() }: { req?: PayloadRequest; now?: Date } = {},
): Promise<Map<string, ReliabilityRecord>> {
  const ids = [...new Set(userIds.map(String))]
  const records = new Map(ids.map((id) => [id, EMPTY_RELIABILITY]))
  if (ids.length === 0) return records

  const registrations = await payload.find({
    collection: 'registrations',
    where: {
      and: [
        { user: { in: ids } },
        { role: { not_equals: 'volunteer' } },
        { deletedAt: { exists: false } },
        {
          or: [
            { attendanceStatus: { in: ['attended', 'excused', 'no_show'] } },
            { selfCancelled: { equals: true } },
          ],
        },
      ],
    },
    select: { user: true, event: true, attendanceStatus: true, selfCancelled: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (registrations.docs.length === 0) return records

  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { id: { in: [...new Set(registrations.docs.map((r) => relId(r.event)))] } },
        { dateTime: { greater_than_equal: reliabilityWindowStart(now).toISOString() } },
      ],
    },
    select: { dateTime: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const startOf = new Map(events.docs.map((e) => [String(e.id), e.dateTime]))

  const entries = new Map<string, ReliabilityEntry[]>()
  for (const registration of registrations.docs) {
    const at = startOf.get(relId(registration.event))
    if (!at) continue
    const kind =
      registration.attendanceStatus === 'attended'
        ? 'attended'
        : registration.attendanceStatus === 'no_show'
          ? 'no_show'
          : 'excused'
    const userId = relId(registration.user)
    entries.set(userId, [...(entries.get(userId) ?? []), { kind, at }])
  }
  for (const [userId, list] of entries) records.set(userId, summarizeReliability(list, now))
  return records
}

export async function reliabilityOf(
  payload: Payload,
  userId: number | string,
  options: { req?: PayloadRequest; now?: Date } = {},
): Promise<ReliabilityRecord> {
  return (await loadReliability(payload, [userId], options)).get(String(userId)) ?? EMPTY_RELIABILITY
}
