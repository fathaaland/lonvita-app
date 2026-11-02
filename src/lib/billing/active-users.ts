import type { Payload } from 'payload'

import { relationNumber } from '@/lib/relations'

import { tierForUsers, type LicenceTier } from './catalog'
import { pragueMonthKey } from './period'

/**
 * The users the obec's licence band is counted from: every registered account whose home obec it
 * is, or who holds a role in it (organizer, admin…) — each person once however many roles they
 * have. A deleted (anonymized) account isn't anyone any more.
 */
export async function countActiveUsers(payload: Payload, municipalityId: number): Promise<number> {
  const [profiles, roles] = await Promise.all([
    payload.find({
      collection: 'profiles',
      where: { municipality: { equals: municipalityId } },
      select: { user: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'user-roles',
      where: { municipality: { equals: municipalityId } },
      select: { user: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])
  const ids = new Set<number>()
  for (const doc of [...profiles.docs, ...roles.docs]) {
    const id = relationNumber(doc.user)
    if (id !== null) ids.add(id)
  }
  if (ids.size === 0) return 0
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: { and: [{ id: { in: [...ids] } }, { anonymizedAt: { exists: false } }] },
    overrideAccess: true,
  })
  return totalDocs
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
  const activeUsers = await countActiveUsers(payload, municipalityId)
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
 * The band the snapshots put the obec in — the average of the last three (Balíčky služeb: "podle
 * průměru posledních 3 snímků"). Without any snapshot yet, the users it has right now.
 */
export function computedTierOf(
  tiers: LicenceTier[],
  snapshots: ActiveUserSnapshot[],
  currentUsers: number,
): { averageUsers: number; tier: number; fromSnapshots: number } {
  const last = snapshots.slice(0, 3)
  const averageUsers =
    last.length > 0
      ? Math.round(last.reduce((sum, s) => sum + s.activeUsers, 0) / last.length)
      : currentUsers
  return { averageUsers, tier: tierForUsers(tiers, averageUsers), fromSnapshots: last.length }
}
