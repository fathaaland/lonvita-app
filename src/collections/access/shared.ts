import type { Access } from 'payload'

export const isLoggedIn: Access = ({ req }) => Boolean(req.user)

/** IDs of municipalities where this user holds an "admin" UserRole (municipality-level, not platform Users.role). */
const getAdministeredMunicipalityIds = async (
  payload: import('payload').Payload,
  userId: number,
): Promise<string[]> => {
  const result = await payload.find({
    collection: 'user-roles',
    where: { and: [{ user: { equals: userId } }, { role: { equals: 'admin' } }] },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })
  return result.docs.map((doc) => String(typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality))
}

/**
 * Allows platform admins (Users.role === 'admin') everywhere, plus municipality admins
 * (a "user-roles" row with role "admin") scoped to the municipalities they administer.
 * Used by collections where a municipality admin needs to manage rows without being a
 * platform-level admin — e.g. approving an organizer request creates a user-roles row.
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
