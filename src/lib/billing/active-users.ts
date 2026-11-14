import type { Payload } from 'payload'

import { sql } from '@payloadcms/db-postgres'

import { pragueMonthKey } from './period'

/** How far back a user counts as active. */
export const ACTIVE_USER_DAYS = 90

/**
 * The obec's active users (interní podklad k ceníku, 13. 11. 2026): accounts whose home obec it is,
 * not deleted, that were signed in (Users.lastSeenAt) or signed up for an event that took place within
 * the last ACTIVE_USER_DAYS — each person once. What the growth band is decided by (lib/billing/
 * licence-tier); the licence itself is priced by the obec's inhabitants. Counted in the database.
 */
export async function countActiveUsers(payload: Payload, municipalityId: number, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - ACTIVE_USER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const until = now.toISOString()
  const { rows } = await payload.db.drizzle.execute<{ n: string }>(sql`
    SELECT COUNT(DISTINCT u.id) AS n
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.municipality_id = ${municipalityId}
      AND p.deleted_at IS NULL
      AND u.anonymized_at IS NULL
      AND (
        (u.last_seen_at >= ${since} AND u.last_seen_at <= ${until})
        OR EXISTS (
          SELECT 1 FROM registrations r JOIN events e ON e.id = r.event_id
          WHERE r.user_id = u.id
            AND r.status = 'approved'
            AND r.deleted_at IS NULL
            AND e.date_time >= ${since} AND e.date_time <= ${until}
        )
      )
  `)
  return Number(rows[0]?.n ?? 0)
}

export type ActiveUserSnapshot = {
  month: string
  activeUsers: number
  takenAt: string
  byHand: boolean
}

/** Counts the obec's users now and keeps it as this month's snapshot — over one taken earlier this
 * month. `takenBy` is the superadmin doing it by hand; none for the monthly job. */
export async function takeActiveUserSnapshot(
  payload: Payload,
  municipalityId: number,
  now: Date,
  takenBy?: number | null,
): Promise<ActiveUserSnapshot> {
  const activeUsers = await countActiveUsers(payload, municipalityId, now)
  const month = pragueMonthKey(now)
  const data = {
    municipality: municipalityId,
    month,
    activeUsers,
    takenAt: now.toISOString(),
    takenBy: takenBy ?? null,
  }
  const existing = await payload.find({
    collection: 'active-user-snapshots',
    where: { and: [{ municipality: { equals: municipalityId } }, { month: { equals: month } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) {
    await payload.update({
      collection: 'active-user-snapshots',
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    })
  } else {
    await payload.create({ collection: 'active-user-snapshots', data, overrideAccess: true })
  }
  return { month, activeUsers, takenAt: data.takenAt, byHand: takenBy != null }
}

/** The obec's snapshots, newest first. */
export async function listActiveUserSnapshots(
  payload: Payload,
  municipalityId: number,
  limit = 12,
): Promise<ActiveUserSnapshot[]> {
  const result = await payload.find({
    collection: 'active-user-snapshots',
    where: { municipality: { equals: municipalityId } },
    sort: '-month',
    depth: 0,
    limit,
    overrideAccess: true,
  })
  return result.docs.map((s) => ({
    month: s.month,
    activeUsers: s.activeUsers,
    takenAt: s.takenAt,
    byHand: s.takenBy != null,
  }))
}

/**
 * The active users the growth band is decided by: the average of the snapshots taken at the end of
 * September and of October (on 1. 10. and 1. 11., months `YYYY-10` and `YYYY-11`) — whichever of them
 * there is. Null without either.
 */
export function autumnAverageUsers(snapshots: ActiveUserSnapshot[], year: number): number | null {
  const autumn = snapshots.filter((s) => s.month === `${year}-10` || s.month === `${year}-11`)
  if (autumn.length === 0) return null
  return Math.round(autumn.reduce((sum, s) => sum + s.activeUsers, 0) / autumn.length)
}
