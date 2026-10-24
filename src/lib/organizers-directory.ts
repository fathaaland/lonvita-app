import type { Payload } from 'payload'

import { notDeleted } from '@/collections/shared/softDelete'
import { toEventRow } from '@/lib/analytics'
import { loadRegistrations } from '@/lib/exports/load'
import { computeOrganizationStats, type OrganizationStats } from '@/lib/organization-stats'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'
import { relationId } from '@/lib/relations'

/** One pořadatel's profile among the obec's organizers — who they are, in their own words, and how
 * their events go. Ratings stay off it: those are the organization's own business (Organizace). */
export type OrganizerProfile = {
  id: string
  name: string
  type: string
  description: string | null
  avatar_url: string | null
  owner_name: string | null
  /** Organizing in the obec since. */
  since: string
  /** The viewer owns it — they edit it on their Organizace page. */
  is_own: boolean
  stats: Omit<OrganizationStats, 'pending'>
  next_event: { id: string; title: string; date_time: string } | null
  /** How to reach its owner — their account e-mail, shown to the obec's other organizers. */
  contact: { email: string | null }
}

/** Whether `viewer` may see the obec's organizers — its admins and organizers, and a platform admin.
 * Someone still waiting on their organizer request isn't one of them yet. */
export async function organizesIn(
  payload: Payload,
  viewer: { id: number; role?: string | null },
  municipalityId: string,
): Promise<boolean> {
  if (viewer.role === 'admin') return true
  const roles = await payload.count({
    collection: 'user-roles',
    where: {
      and: [
        { user: { equals: viewer.id } },
        { municipality: { equals: municipalityId } },
        { role: { in: ['municipality_admin', 'organizer'] } },
      ],
    },
    overrideAccess: true,
  })
  return roles.totalDocs > 0
}

/** Every organization that organizes in the obec (not the obec's own), with the same headline numbers
 * as their Organizace page — computed here, since a fellow organizer can't read the registrations.
 * An organization whose owner has lost the organizer role stays (its events go on) but no longer
 * organizes here, so it isn't listed — mirrors co-organizer-candidates. */
export async function loadOrganizersDirectory(
  payload: Payload,
  municipalityId: string,
  viewerId: number,
): Promise<OrganizerProfile[]> {
  const roles = await payload.find({
    collection: 'user-roles',
    where: { and: [{ municipality: { equals: municipalityId } }, { role: { equals: 'organizer' } }] },
    select: { user: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const organizerIds = [...new Set(roles.docs.map((r) => relationId(r.user)).filter((id): id is string => id !== null))]
  if (organizerIds.length === 0) return []

  const organizations = await payload.find({
    collection: 'organizations',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { type: { not_equals: MUNICIPALITY_ORGANIZATION_TYPE } },
        { owner: { in: organizerIds } },
        notDeleted,
      ],
    },
    sort: 'name',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  if (organizations.docs.length === 0) return []
  const organizationIds = organizations.docs.map((o) => String(o.id))
  const ownerIds = [...new Set(organizations.docs.map((o) => relationId(o.owner)).filter((id): id is string => id !== null))]

  const [events, owners, ownerUsers] = await Promise.all([
    payload.find({
      collection: 'events',
      where: {
        and: [
          { or: [{ organization: { in: organizationIds } }, { coOrganizations: { in: organizationIds } }] },
          notDeleted,
        ],
      },
      sort: 'dateTime',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    ownerIds.length > 0
      ? payload.find({
          collection: 'profiles',
          where: { user: { in: ownerIds } },
          select: { user: true, fullName: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : Promise.resolve({ docs: [] }),
    ownerIds.length > 0
      ? payload.find({
          collection: 'users',
          where: { id: { in: ownerIds } },
          select: { email: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : Promise.resolve({ docs: [] }),
  ])
  const registrations = await loadRegistrations(
    payload,
    events.docs.map((e) => String(e.id)),
  )
  const ownerProfile = new Map(owners.docs.map((p) => [relationId(p.user), p]))
  const ownerEmail = new Map(ownerUsers.docs.map((u) => [String(u.id), u.email]))
  const now = Date.now()

  return organizations.docs.map((organization) => {
    const id = String(organization.id)
    const own = events.docs.filter(
      (e) => relationId(e.organization) === id || (e.coOrganizations ?? []).map(relationId).includes(id),
    )
    const ownIds = new Set(own.map((e) => String(e.id)))
    const coOrganizedIds = new Set(own.filter((e) => relationId(e.organization) !== id).map((e) => String(e.id)))
    const { pending: _pending, ...stats } = computeOrganizationStats(
      own.map(toEventRow),
      registrations.filter((r) => ownIds.has(r.event_id)),
      coOrganizedIds,
      now,
    )
    const next = own.find(
      (e) => e.status !== 'cancelled' && !e.isDraft && new Date(e.dateTime).getTime() >= now,
    )
    return {
      id,
      name: organization.name,
      type: organization.type,
      description: organization.description ?? null,
      avatar_url: organization.avatarUrl ?? null,
      owner_name: ownerProfile.get(relationId(organization.owner))?.fullName ?? null,
      since: organization.createdAt,
      is_own: relationId(organization.owner) === String(viewerId),
      stats,
      next_event: next ? { id: String(next.id), title: next.title, date_time: next.dateTime } : null,
      contact: { email: ownerEmail.get(relationId(organization.owner) ?? '') ?? null },
    }
  })
}
