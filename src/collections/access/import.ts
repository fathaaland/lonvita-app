import type { Access, Payload, PayloadRequest, Where } from 'payload'

import { relationId } from '@/lib/relations'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

import { getAdministeredMunicipalityIds, getOrganizerMunicipalityIds } from './shared'

/**
 * Everything about importing events (EventSources, EventImportCandidates, ImportRuns) belongs to an
 * obec — and within it either to the obec itself (`organization` empty: its admins look after it and
 * take events over as the obec) or to one of its approved organizers (`organization` = theirs: they
 * look after it and take events over as their organization). Both work the same way and draw on the
 * same thing: the obec's scraping package (lib/billing/scraping) — the obec's admins see who used how
 * much of it (api/admin/municipality-usage). Neither sees the other's records; a platform admin sees
 * all of them.
 */

type Viewer = { id: number | string; role?: string | null }

/**
 * The organizations `userId` imports as: their own organization in every obec they still hold the
 * organizer role in. One whose role was taken away no longer imports there.
 */
export async function getImportingOrganizationIds(
  payload: Payload,
  userId: number | string,
  req?: PayloadRequest,
): Promise<string[]> {
  const municipalityIds = await getOrganizerMunicipalityIds(payload, Number(userId), req)
  if (municipalityIds.length === 0) return []
  const result = await payload.find({
    collection: 'organizations',
    where: {
      and: [
        { owner: { equals: userId } },
        { municipality: { in: municipalityIds } },
        { type: { not_equals: MUNICIPALITY_ORGANIZATION_TYPE } },
        { deletedAt: { exists: false } },
      ],
    },
    select: {},
    depth: 0,
    limit: 200,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return result.docs.map((doc) => String(doc.id))
}

/**
 * Whom `user` imports for in `municipalityId`: `{ organization: null }` as the obec (its admin, or a
 * platform admin), `{ organization: id }` as their organization (an approved organizer there), or
 * null — they don't import there. An obec admin who also organizes there imports as the obec, the
 * way the events they found are the obec's (Events resolveOrganizations).
 */
export async function importOwnerFor(
  payload: Payload,
  user: Viewer,
  municipalityId: number | string,
  req?: PayloadRequest,
): Promise<{ organization: number | null } | null> {
  if (!Number(municipalityId)) return null
  if (user.role === 'admin') return { organization: null }
  if ((await getAdministeredMunicipalityIds(payload, Number(user.id), req)).includes(String(municipalityId))) {
    return { organization: null }
  }
  if (!(await getOrganizerMunicipalityIds(payload, Number(user.id), req)).includes(String(municipalityId))) return null
  const found = await payload.find({
    collection: 'organizations',
    where: {
      and: [
        { owner: { equals: user.id } },
        { municipality: { equals: municipalityId } },
        { type: { not_equals: MUNICIPALITY_ORGANIZATION_TYPE } },
        { deletedAt: { exists: false } },
      ],
    },
    select: {},
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  const organizationId = found.docs[0]?.id
  return organizationId ? { organization: organizationId } : null
}

export const canAccessImportRecords: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true
  const [administered, organizations] = await Promise.all([
    getAdministeredMunicipalityIds(payload, user.id, req),
    getImportingOrganizationIds(payload, user.id, req),
  ])
  const or: Where[] = []
  if (administered.length > 0) {
    or.push({ and: [{ municipality: { in: administered } }, { organization: { exists: false } }] })
  }
  if (organizations.length > 0) or.push({ organization: { in: organizations } })
  return or.length > 0 ? { or } : false
}

/** The single-record form: whether `user` looks after what belongs to `owner`. */
export async function mayManageImport(
  payload: Payload,
  user: Viewer,
  owner: { municipality: unknown; organization?: unknown },
): Promise<boolean> {
  if (user.role === 'admin') return true
  const organizationId = relationId(owner.organization)
  if (organizationId) return (await getImportingOrganizationIds(payload, user.id)).includes(organizationId)
  const municipalityId = relationId(owner.municipality)
  return (
    Boolean(municipalityId) &&
    (await getAdministeredMunicipalityIds(payload, Number(user.id))).includes(municipalityId!)
  )
}
