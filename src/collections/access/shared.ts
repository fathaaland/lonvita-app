import type { Access, FieldAccess, Where } from 'payload'

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
 *
 * Only valid for `read`/`update`/`delete` — Payload only ever applies an Access function's
 * returned `Where` clause to *filter existing rows*, which a `create` has none of. Wiring this
 * to `access.create` would silently grant unrestricted create (see `canCreateForAdministeredMunicipality`).
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

/**
 * The `create`-safe counterpart to `isPlatformOrMunicipalityAdmin` above: a `create` access
 * function has no existing row to filter, so it must resolve to an actual boolean, checked
 * against the municipality on the submitted `data` itself — otherwise a municipality admin of
 * *any* obec could create rows filed under an obec they don't administer (e.g. grant themselves
 * "municipality_admin" of a town they have no role in).
 */
export const canCreateForAdministeredMunicipality =
  (municipalityField = 'municipality'): Access =>
  async ({ req, data }) => {
    const { user, payload } = req
    if (!user) return false
    if (user.role === 'admin') return true

    const municipalityIds = await getAdministeredMunicipalityIds(payload, user.id)
    if (municipalityIds.length === 0) return false

    const submitted = (data as Record<string, unknown> | undefined)?.[municipalityField]
    const submittedId =
      submitted && typeof submitted === 'object' && 'id' in submitted
        ? String((submitted as { id: unknown }).id)
        : submitted != null
          ? String(submitted)
          : undefined

    return submittedId ? municipalityIds.includes(submittedId) : false
  }

/**
 * Allows platform admins (Users.role === 'admin') everywhere; otherwise restricts read
 * access to rows the user owns (via `ownerField`, e.g. "user" or "requestedBy") or that
 * belong to a municipality they administer (via `municipalityWhereField`, which may be a
 * nested path like "event.municipality").
 */
export const canReadOwnOrAdministered =
  (ownerField: string, municipalityWhereField = 'municipality'): Access =>
  async ({ req }) => {
    const { user, payload } = req
    if (!user) return false
    if (user.role === 'admin') return true

    const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
    const or: Where[] = [{ [ownerField]: { equals: user.id } }]
    if (administeredIds.length > 0) or.push({ [municipalityWhereField]: { in: administeredIds } })
    return { or }
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

/**
 * Field-level read access for a profile's volunteer-pool fields: only the person themselves,
 * a platform admin, or an admin/organizer of the municipality the profile belongs to may see
 * them — a volunteer signs up for their own obec's pool, not every obec's.
 *
 * Without a `doc` Payload is asking whether the field may be used in a `where` query; only a
 * platform admin may, so no one can list another obec's volunteers by filtering on `isVolunteer`.
 * Listing a municipality's pool goes through GET /api/admin/volunteers instead.
 */
export const canReadVolunteerFields: FieldAccess = async ({ req, doc }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true
  if (!doc) return false

  const ownerId = typeof doc.user === 'object' && doc.user ? doc.user.id : doc.user
  if (String(ownerId) === String(user.id)) return true

  const municipality = typeof doc.municipality === 'object' && doc.municipality ? doc.municipality.id : doc.municipality
  if (municipality == null) return false

  // Field access runs once per profile per field, so resolve the viewer's obce once per request.
  const cacheKey = 'volunteerFieldsMunicipalityIds'
  if (!req.context[cacheKey]) {
    req.context[cacheKey] = Promise.all([
      getAdministeredMunicipalityIds(payload, user.id),
      getOrganizerMunicipalityIds(payload, user.id),
    ]).then(([administered, organizer]) => [...administered, ...organizer])
  }
  const municipalityIds = await (req.context[cacheKey] as Promise<string[]>)
  return municipalityIds.includes(String(municipality))
}
