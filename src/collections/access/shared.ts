import type { Access } from 'payload'

export const isLoggedIn: Access = ({ req }) => Boolean(req.user)

/** IDs of municipalities where this user holds a "municipality_admin" UserRole (municipality-level, not platform Users.role). */
export const getAdministeredMunicipalityIds = async (
  payload: import('payload').Payload,
  userId: number,
): Promise<string[]> => {
  const result = await payload.find({
    collection: 'user-roles',
    where: { and: [{ user: { equals: userId } }, { role: { equals: 'municipality_admin' } }] },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })
  return result.docs.map((doc) => String(typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality))
}

/**
 * Allows platform admins (Users.role === 'admin') everywhere, plus municipality admins
 * (a "user-roles" row with role "municipality_admin") scoped to the municipalities they administer.
 * Used by collections where a municipality admin needs to manage rows without being a
 * platform-level admin.
 */
export const isPlatformOrMunicipalityAdmin =
  (municipalityField = 'municipality'): Access =>
  async ({ req }) => {
    const { user, payload } = req
    if (!user) return false
    if (user.role === 'admin') return true

    const municipalityIds = await getAdministeredMunicipalityIds(payload, user.id)
    if (municipalityIds.length === 0) return false

    return { [municipalityField]: { in: municipalityIds } }
  }

/** IDs of municipalities where this user holds an "organizer" UserRole. */
export const getOrganizerMunicipalityIds = async (
  payload: import('payload').Payload,
  userId: number,
): Promise<string[]> => {
  const result = await payload.find({
    collection: 'user-roles',
    where: { and: [{ user: { equals: userId } }, { role: { equals: 'organizer' } }] },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })
  return result.docs.map((doc) => String(typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality))
}
