import type { Access, Payload, Where } from 'payload'

import { relationId } from '@/lib/relations'

import { getAdministeredMunicipalityIds } from './shared'

/**
 * Everything about importing events (EventSources, EventImportCandidates, ImportRuns) belongs either
 * to an obec — its admins look after it and take events over as the obec — or to an organizer's
 * organization, whose owner takes them over as the organizer. Neither sees the other's: an obec's
 * admin doesn't decide what the café's calendar brings. A platform admin sees all of it.
 */

/** Organizations the user owns (and hasn't had deleted). */
export async function getOwnedOrganizationIds(
  payload: Payload,
  userId: number | string,
): Promise<string[]> {
  const result = await payload.find({
    collection: 'organizations',
    where: { and: [{ owner: { equals: userId } }, { deletedAt: { exists: false } }] },
    select: {},
    depth: 0,
    limit: 50,
    overrideAccess: true,
  })
  return result.docs.map((doc) => String(doc.id))
}

export const canAccessImportRecords: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true
  const [administered, owned] = await Promise.all([
    getAdministeredMunicipalityIds(payload, user.id),
    getOwnedOrganizationIds(payload, user.id),
  ])
  const or: Where[] = []
  if (administered.length > 0) {
    or.push({
      and: [{ municipality: { in: administered } }, { organization: { exists: false } }],
    })
  }
  if (owned.length > 0) or.push({ organization: { in: owned } })
  return or.length > 0 ? { or } : false
}

/** The single-record form: whether `user` looks after what belongs to `owner`. */
export async function mayManageImport(
  payload: Payload,
  user: { id: number | string; role?: string | null },
  owner: { municipality: unknown; organization?: unknown },
): Promise<boolean> {
  if (user.role === 'admin') return true
  const organizationId = relationId(owner.organization)
  if (organizationId)
    return (await getOwnedOrganizationIds(payload, user.id)).includes(organizationId)
  const municipalityId = relationId(owner.municipality)
  return (
    Boolean(municipalityId) &&
    (await getAdministeredMunicipalityIds(payload, Number(user.id))).includes(municipalityId!)
  )
}
