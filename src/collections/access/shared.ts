import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

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
 * Field-level read access for a profile's volunteer-pool fields: only the person themselves and a
 * platform admin. Organizers see the pool through GET /api/admin/volunteers, which shows each
 * volunteer's contact only on the channels they allowed — never these raw fields.
 *
 * Without a `doc` Payload is asking whether the field may be used in a `where` query; only a
 * platform admin may, so nobody can list the pool by filtering on `isVolunteer`.
 */
export const canReadVolunteerFields: FieldAccess = ({ req, doc }) => {
  const { user } = req
  if (!user) return false
  if (user.role === 'admin') return true
  if (!doc) return false
  const ownerId = typeof doc.user === 'object' && doc.user ? doc.user.id : doc.user
  return String(ownerId) === String(user.id)
}

const profileOwnerId = (doc: Record<string, unknown>): string | null => {
  const owner = doc.user as number | { id: number } | null | undefined
  return owner == null ? null : String(typeof owner === 'object' ? owner.id : owner)
}

/** Looked up once per request — a profile list asks for every document's fields. */
const perRequest = <T>(req: PayloadRequest, key: string, load: () => Promise<T>): Promise<T> => {
  const context = (req.context ??= {}) as Record<string, unknown>
  return (context[key] ??= load()) as Promise<T>
}

const administeredIdsOf = (req: PayloadRequest, userId: number) =>
  perRequest(req, `profileAccess:administered:${userId}`, () => getAdministeredMunicipalityIds(req.payload, userId))

/** Events `userId` runs or co-organizes, or that are in an obec they administer — their Spravovat pages. */
const eventsManagedBy = (req: PayloadRequest, userId: number) =>
  perRequest(req, `profileAccess:events:${userId}`, async () => {
    const administeredIds = await administeredIdsOf(req, userId)
    const managed: Where[] = [{ organizer: { equals: userId } }, { coOrganizers: { in: [userId] } }]
    if (administeredIds.length > 0) managed.push({ municipality: { in: administeredIds } })
    const events = await req.payload.find({
      collection: 'events',
      where: { or: managed },
      select: { organizer: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    return events.docs.map((e) => e.id)
  })

const relUserId = (value: unknown) => String(value && typeof value === 'object' ? (value as { id: number }).id : value)

/** Everyone registered (in any status) for an event `userId` manages — the people on their
 * Spravovat pages. */
const registrantsManagedBy = (req: PayloadRequest, userId: number) =>
  perRequest(req, `profileAccess:registrants:${userId}`, async () => {
    const eventIds = await eventsManagedBy(req, userId)
    if (eventIds.length === 0) return new Set<string>()
    const registrations = await req.payload.find({
      collection: 'registrations',
      where: { and: [{ event: { in: eventIds } }, { deletedAt: { exists: false } }] },
      select: { user: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    return new Set(registrations.docs.map((r) => relUserId(r.user)))
  })

/**
 * Whose profile (name, photo, home obec) someone may read — not a directory of every user:
 * - their own, and a platform admin everyone's;
 * - whoever organizes or co-organizes an event, or holds the organizer role — the public face of
 *   events (the name on the event detail, on an invitation, on a co-organizing request);
 * - who signed up for, or was invited / offered to help on, an event they manage;
 * - for an obec's admin: its residents and whoever holds or asks for a role in it.
 * Phone, date of birth and the volunteer fields keep their own, narrower field access.
 */
export const canReadProfile: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const [organizers, organizerRoles, registrants, eventIds, administeredIds] = await Promise.all([
    payload.find({
      collection: 'events',
      where: { deletedAt: { exists: false } },
      select: { organizer: true, coOrganizers: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'user-roles',
      where: { role: { equals: 'organizer' } },
      select: { user: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    registrantsManagedBy(req, user.id),
    eventsManagedBy(req, user.id),
    administeredIdsOf(req, user.id),
  ])

  const visible = new Set<string>(registrants)
  for (const e of organizers.docs) {
    visible.add(relUserId(e.organizer))
    for (const co of e.coOrganizers ?? []) visible.add(relUserId(co))
  }
  for (const r of organizerRoles.docs) visible.add(relUserId(r.user))

  if (eventIds.length > 0) {
    const invitations = await payload.find({
      collection: 'volunteer-invitations',
      where: { event: { in: eventIds } },
      select: { volunteer: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    for (const i of invitations.docs) visible.add(relUserId(i.volunteer))
  }

  const or: Where[] = [{ user: { equals: user.id } }]
  if (administeredIds.length > 0) {
    or.push({ municipality: { in: administeredIds } })
    const [roles, requests] = await Promise.all([
      payload.find({
        collection: 'user-roles',
        where: { municipality: { in: administeredIds } },
        select: { user: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'organizer-requests',
        where: { municipality: { in: administeredIds } },
        select: { user: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
    ])
    for (const doc of [...roles.docs, ...requests.docs]) visible.add(relUserId(doc.user))
  }
  visible.delete('null')
  visible.delete('undefined')
  if (visible.size > 0) or.push({ user: { in: [...visible].map(Number) } })
  return { or }
}

/**
 * Field-level read access for what a profile's onboarding asks (gender, interests, home area): only
 * the person themselves and a platform admin — nothing else in the app reads them. Like
 * canReadVolunteerFields, nobody else may filter by them either.
 */
export const canReadOwnProfileField: FieldAccess = ({ req, doc }) => {
  const { user } = req
  if (!user) return false
  if (user.role === 'admin') return true
  return Boolean(doc) && profileOwnerId(doc!) === String(user.id)
}

/** Date of birth: also the admins of the person's home obec — its analytics count the residents
 * aged 50+ (Datavita). */
export const canReadDateOfBirth: FieldAccess = async ({ req, doc }) => {
  const { user } = req
  if (!user) return false
  if (user.role === 'admin') return true
  if (!doc) return false
  if (profileOwnerId(doc) === String(user.id)) return true
  const municipality = doc.municipality as number | { id: number } | null | undefined
  if (municipality == null) return false
  const municipalityId = String(typeof municipality === 'object' ? municipality.id : municipality)
  return (await administeredIdsOf(req, user.id)).includes(municipalityId)
}

/** Phone: also whoever runs an event the person signed up for — the event's pořadatel,
 * spolupořadatelé and the obec's admins — to reach them about it (the Spravovat page). */
export const canReadPhone: FieldAccess = async ({ req, doc }) => {
  const { user } = req
  if (!user) return false
  if (user.role === 'admin') return true
  if (!doc) return false
  const ownerId = profileOwnerId(doc)
  if (ownerId === null) return false
  if (ownerId === String(user.id)) return true
  return (await registrantsManagedBy(req, user.id)).has(ownerId)
}
