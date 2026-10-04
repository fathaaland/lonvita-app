import type { Payload } from 'payload'

import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { notDeleted } from '@/collections/shared/softDelete'
import type { Profile } from '@/payload-types'

type Viewer = { id: number; role?: string | null }

type AvatarMedia = { url?: string | null; sizes?: { avatar?: { url?: string | null } | null } | null }

/** The square avatar crop, else the original — a photo smaller than the crop gets no crop. */
const avatarUrlOf = (media: unknown): string | null =>
  media && typeof media === 'object'
    ? ((media as AvatarMedia).sizes?.avatar?.url ?? (media as AvatarMedia).url ?? null)
    : null

const relId = (value: unknown): number | null =>
  value == null ? null : typeof value === 'object' ? (value as { id: number }).id : (value as number)

/** One volunteer as organizers see them — on the pool table, the volunteer map and their card.
 * Contact only on the channels the volunteer allowed. */
export type VolunteerCard = {
  id: string
  user_id: string
  full_name: string
  avatar_url: string | null
  /** Where they help — the obec that puts them on the volunteer map. */
  location: { id: string; name: string; lat: number; lng: number } | null
  email: string | null
  phone: string | null
  volunteer_focus: string[] | null
  volunteer_note: string | null
  volunteer_since: string | null
  rating: { average: number; count: number } | null
  /** The viewer may take them off the pool — a platform admin, or an admin of the obec they help in
   * while they have no role on any event (helpingOnEvents). */
  can_remove: boolean
}

/** Whoever organizes anywhere — a platform admin, or a "municipality_admin"/"organizer" role in any obec. */
export async function organizesSomewhere(payload: Payload, viewer: Viewer): Promise<boolean> {
  if (viewer.role === 'admin') return true
  const roles = await payload.count({
    collection: 'user-roles',
    where: { and: [{ user: { equals: viewer.id } }, { role: { in: ['municipality_admin', 'organizer'] } }] },
    overrideAccess: true,
  })
  return roles.totalDocs > 0
}

/** Average rating and count per volunteer (user id). */
export async function ratingsByVolunteer(
  payload: Payload,
  userIds: number[],
): Promise<Map<number, { average: number; count: number }>> {
  const result = new Map<number, { average: number; count: number }>()
  if (userIds.length === 0) return result
  const ratings = await payload.find({
    collection: 'volunteer-ratings',
    where: { and: [{ volunteer: { in: userIds } }, notDeleted] },
    select: { volunteer: true, rating: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const sums = new Map<number, { sum: number; count: number }>()
  for (const r of ratings.docs) {
    const id = relId(r.volunteer)!
    const s = sums.get(id) ?? { sum: 0, count: 0 }
    sums.set(id, { sum: s.sum + r.rating, count: s.count + 1 })
  }
  for (const [id, s] of sums) result.set(id, { average: Math.round((s.sum / s.count) * 10) / 10, count: s.count })
  return result
}

/** Of `userIds`, who has a role on an event right now — a volunteer place (pending or approved) on
 * one that hasn't ended and wasn't cancelled. Such a volunteer is the event creator's to decide
 * about, so the obec doesn't take them off the pool meanwhile. */
export async function helpingOnEvents(payload: Payload, userIds: (number | string)[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const registrations = await payload.find({
    collection: 'registrations',
    where: {
      and: [
        { user: { in: userIds } },
        { role: { equals: 'volunteer' } },
        { status: { in: ['pending', 'approved'] } },
        { deletedAt: { exists: false } },
      ],
    },
    select: { user: true, event: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  if (registrations.docs.length === 0) return new Set()
  const now = new Date().toISOString()
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { id: { in: [...new Set(registrations.docs.map((r) => relId(r.event)))] } },
        { status: { not_equals: 'cancelled' } },
        notDeleted,
        {
          or: [
            { endDateTime: { greater_than_equal: now } },
            { and: [{ endDateTime: { exists: false } }, { dateTime: { greater_than_equal: now } }] },
          ],
        },
      ],
    },
    select: { status: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const ongoing = new Set(events.docs.map((e) => e.id))
  return new Set(registrations.docs.filter((r) => ongoing.has(relId(r.event)!)).map((r) => String(relId(r.user))))
}

/** Profiles read at depth 1 (avatar, volunteerMunicipality populated) → the volunteers' cards. */
export async function toVolunteerCards(payload: Payload, profiles: Profile[], viewer: Viewer): Promise<VolunteerCard[]> {
  const userIds = profiles.map((p) => relId(p.user)!)
  const [ratings, administeredIds, helping] = await Promise.all([
    ratingsByVolunteer(payload, userIds),
    viewer.role === 'admin' ? Promise.resolve([] as string[]) : getAdministeredMunicipalityIds(payload, viewer.id),
    viewer.role === 'admin' ? Promise.resolve(new Set<string>()) : helpingOnEvents(payload, userIds),
  ])

  return profiles.map((p) => {
    const userId = relId(p.user)!
    const place = typeof p.volunteerMunicipality === 'object' ? p.volunteerMunicipality : null
    return {
      id: String(p.id),
      user_id: String(userId),
      full_name: p.fullName,
      avatar_url: avatarUrlOf(p.avatar),
      location: place ? { id: String(place.id), name: place.name, lat: place.lat, lng: place.lng } : null,
      email: p.volunteerAllowEmail ? (p.volunteerContactEmail ?? null) : null,
      phone: p.volunteerAllowPhone ? (p.volunteerContactPhone ?? null) : null,
      volunteer_focus: p.volunteerFocus ?? null,
      volunteer_note: p.volunteerNote ?? null,
      volunteer_since: p.volunteerSince ?? null,
      rating: ratings.get(userId) ?? null,
      can_remove:
        viewer.role === 'admin' ||
        (place !== null && administeredIds.includes(String(place.id)) && !helping.has(String(userId))),
    }
  })
}
