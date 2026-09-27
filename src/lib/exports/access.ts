import type { Payload } from 'payload'

import { getAdministeredMunicipalityIds } from '@/collections/access/shared'

import type { ExportRequest } from './contracts'

type Viewer = { id: number; role?: string | null }

export type AccessResult = 'allowed' | 'forbidden' | 'missing'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** The obec's dashboard — its municipality_admin, or a platform admin. */
export async function canAccessMunicipality(payload: Payload, viewer: Viewer, municipalityId: string): Promise<boolean> {
  if (viewer.role === 'admin') return true
  return (await getAdministeredMunicipalityIds(payload, viewer.id)).includes(municipalityId)
}

/** The "Organizace" page — its owner, an admin of the organization's obec, or a platform admin. */
export async function canAccessOrganization(
  payload: Payload,
  viewer: Viewer,
  organizationId: number | string,
): Promise<AccessResult> {
  const organization = await payload
    .findByID({ collection: 'organizations', id: organizationId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!organization || organization.deletedAt) return 'missing'

  if (viewer.role === 'admin' || relationId(organization.owner) === String(viewer.id)) return 'allowed'
  const municipalityId = relationId(organization.municipality)
  if (municipalityId !== null && (await getAdministeredMunicipalityIds(payload, viewer.id)).includes(municipalityId)) {
    return 'allowed'
  }
  return 'forbidden'
}

/** May `viewer` have this file made? The same people who can see its numbers on screen. */
export async function canRequestExport(payload: Payload, viewer: Viewer, request: ExportRequest): Promise<AccessResult> {
  switch (request.kind) {
    case 'community-report':
    case 'municipality-events':
      return (await canAccessMunicipality(payload, viewer, request.params.municipalityId)) ? 'allowed' : 'forbidden'
    case 'organization-report':
      return canAccessOrganization(payload, viewer, request.params.organizationId)
  }
}

/** The `exports` row if `viewer` may see it (its owner or a platform admin), otherwise null — a
 * stranger's export answers exactly like a missing one, so ids can't be probed. */
export async function findViewableExport(payload: Payload, viewer: Viewer, exportId: string) {
  if (!/^\d+$/.test(exportId)) return null
  const record = await payload
    .findByID({ collection: 'exports', id: exportId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!record) return null
  if (viewer.role !== 'admin' && relationId(record.owner) !== String(viewer.id)) return null
  return record
}
