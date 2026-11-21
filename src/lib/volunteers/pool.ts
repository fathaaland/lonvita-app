import type { Payload, PayloadRequest } from 'payload'

import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { notDeleted } from '@/collections/shared/softDelete'
import type { Profile } from '@/payload-types'
import { regionMunicipalityIds } from '@/lib/microregions'
import { relationId, relationNumber } from '@/lib/relations'

type Viewer = { id: number; role?: string | null }

type AvatarMedia = { url?: string | null; sizes?: { avatar?: { url?: string | null } | null } | null }

/** The square avatar crop, else the original — a photo smaller than the crop gets no crop. */
const avatarUrlOf = (media: unknown): string | null =>
  media && typeof media === 'object'
    ? ((media as AvatarMedia).sizes?.avatar?.url ?? (media as AvatarMedia).url ?? null)
    : null

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

/**
 * The obce whose volunteer pool the viewer may reach as their own: every obec they administer
 * (an obec and its admins always reach its pool), and those where they organize with
 * `volunteerAccess` — the obec allowed it (OrganizerRequests, api/user-roles/[id]/volunteer-access).
 * An organizer without it doesn't reach the pool at all: neither lists it, nor invites from it, nor
 * marks events as volunteering ones (Events guardIsVolunteering).
 */
export async function poolMunicipalityIdsOf(payload: Payload, viewer: Viewer, req?: PayloadRequest): Promise<string[]> {
  const roles = await payload.find({
    collection: 'user-roles',
    where: {
      and: [
        { user: { equals: viewer.id } },
        {
          or: [
            { role: { equals: 'municipality_admin' } },
            { and: [{ role: { equals: 'organizer' } }, { volunteerAccess: { equals: true } }] },
          ],
        },
      ],
    },
    select: { municipality: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return [...new Set(roles.docs.map((r) => relationId(r.municipality)).filter((id): id is string => id !== null))]
}

/** Whoever may look into the pool at all — a platform admin, an obec's admin, or an organizer the
 * obec let in (poolMunicipalityIdsOf). */
export async function organizesSomewhere(payload: Payload, viewer: Viewer): Promise<boolean> {
  if (viewer.role === 'admin') return true
  return (await poolMunicipalityIdsOf(payload, viewer)).length > 0
}

/** Where the viewer may reach volunteers: the obce whose pool they may reach (poolMunicipalityIdsOf)
 * and the rest of those obce's mikroregions (lib/microregions) — null for a platform admin, who sees
 * the whole pool. A volunteer helps where their volunteer card says, and nowhere else. */
export async function volunteerReachOf(payload: Payload, viewer: Viewer): Promise<number[] | null> {
  if (viewer.role === 'admin') return null
  const own = await poolMunicipalityIdsOf(payload, viewer)
  const reach = new Set<string>()
  for (const id of own) for (const m of await regionMunicipalityIds(payload, id)) reach.add(m)
  return [...reach].map(Number)
}

/** Whether `user` may reach the pool for an event in `municipalityId` — the obec's own pool, by
 * administering it or organizing there with `volunteerAccess`. */
export async function hasPoolAccessIn(
  req: PayloadRequest,
  user: Viewer,
  municipalityId: number | string | null | undefined,
): Promise<boolean> {
  if (user.role === 'admin') return true
  if (municipalityId == null) return false
  const key = `poolMunicipalityIds:${user.id}`
  let ids = req.context?.[key] as string[] | undefined
  if (!ids) {
    ids = await poolMunicipalityIdsOf(req.payload, user, req)
    if (req.context) req.context[key] = ids
  }
  return ids.includes(String(municipalityId))
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
    const id = relationNumber(r.volunteer)!
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
        { id: { in: [...new Set(registrations.docs.map((r) => relationNumber(r.event)))] } },
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
  return new Set(registrations.docs.filter((r) => ongoing.has(relationNumber(r.event)!)).map((r) => String(relationNumber(r.user))))
}

/** Profiles read at depth 1 (avatar, volunteerMunicipality populated) → the volunteers' cards. */
export async function toVolunteerCards(payload: Payload, profiles: Profile[], viewer: Viewer): Promise<VolunteerCard[]> {
  const userIds = profiles.map((p) => relationNumber(p.user)!)
  const [ratings, administeredIds, helping] = await Promise.all([
    ratingsByVolunteer(payload, userIds),
    viewer.role === 'admin' ? Promise.resolve([] as string[]) : getAdministeredMunicipalityIds(payload, viewer.id),
    viewer.role === 'admin' ? Promise.resolve(new Set<string>()) : helpingOnEvents(payload, userIds),
  ])

  return profiles.map((p) => {
    const userId = relationNumber(p.user)!
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
