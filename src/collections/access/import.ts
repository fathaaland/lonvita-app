import type { Access, Payload, Where } from 'payload'

import { relationId } from '@/lib/relations'

import { getAdministeredMunicipalityIds } from './shared'

/**
 * Everything about importing events (EventSources, EventImportCandidates, ImportRuns) belongs to an
 * obec — its admins look after it and take events over as the obec. Organizers don't import: what
 * the obec's calendar brings is the obec's business. A platform admin sees all of it.
 *
 * Records still carrying an `organization` (organizers' sources from before) belong to no obec
 * admin — they wait for the migration that removes them.
 */

export const canAccessImportRecords: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true
  const administered = await getAdministeredMunicipalityIds(payload, user.id)
  if (administered.length === 0) return false
  const where: Where = {
    and: [{ municipality: { in: administered } }, { organization: { exists: false } }],
  }
  return where
}

/** The single-record form: whether `user` looks after what belongs to `owner`. */
export async function mayManageImport(
  payload: Payload,
  user: { id: number | string; role?: string | null },
  owner: { municipality: unknown; organization?: unknown },
): Promise<boolean> {
  if (user.role === 'admin') return true
  if (relationId(owner.organization)) return false
  const municipalityId = relationId(owner.municipality)
  return (
    Boolean(municipalityId) &&
    (await getAdministeredMunicipalityIds(payload, Number(user.id))).includes(municipalityId!)
  )
}
