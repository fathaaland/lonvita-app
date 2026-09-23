import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  DateField,
  PayloadRequest,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { deletedAtField, notDeleted } from './shared/softDelete'
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
  MUNICIPALITY_ORGANIZATION_TYPE,
  isOrganizationType,
  type OrganizationType,
} from '@/lib/organizations'

/** The owner renames their own organization; the obec's admins and a platform admin may too. */
const canUpdateOrganization: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  const or: Where[] = [{ owner: { equals: user.id } }]
  if (administeredIds.length > 0) or.push({ municipality: { in: administeredIds } })
  return { or }
}

const platformAdminOnly = ({ req: { user } }: { req: { user: { role?: string } | null } }) => user?.role === 'admin'

const relId = (value: number | { id: number }): number => (typeof value === 'object' ? value.id : value)

const validateOrganization: CollectionBeforeValidateHook = async ({ data, req, operation, originalDoc }) => {
  if (!data) return data

  if (operation === 'update' && originalDoc) {
    const wasObec = originalDoc.type === MUNICIPALITY_ORGANIZATION_TYPE
    if (data.type !== undefined && (data.type === MUNICIPALITY_ORGANIZATION_TYPE) !== wasObec) {
      throw new APIError(
        wasObec ? 'Organizace obce zůstává organizací obce.' : 'Organizaci obce zakládá aplikace sama s obcí.',
        400,
      )
    }
    if (wasObec && data.deletedAt) {
      throw new APIError('Organizaci obce nejde smazat — patří k obci.', 400)
    }
  }

  if (operation === 'create') {
    if (data.type === MUNICIPALITY_ORGANIZATION_TYPE) {
      // Only ensureMunicipalityOrganization makes it — one per obec, owned by nobody.
      if (!req.context?.municipalityOrganization) {
        throw new APIError('Organizaci obce zakládá aplikace sama s obcí.', 400)
      }
      data.owner = null
      const existing = await req.payload.find({
        collection: 'organizations',
        where: {
          and: [{ municipality: { equals: data.municipality } }, { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }],
        },
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
      })
      if (existing.docs.length > 0) throw new APIError('Obec už svou organizaci má.', 400)
    } else if (!data.owner) {
      throw new APIError('Organizace musí mít vlastníka.', 400)
    }
  }

  if (typeof data.name === 'string') {
    data.name = data.name.trim()
    if (data.name.length < ORGANIZATION_NAME_MIN_LENGTH) {
      throw new APIError(`Název organizace musí mít aspoň ${ORGANIZATION_NAME_MIN_LENGTH} znaky.`, 400)
    }
  }

  if (operation === 'create' && data.owner && data.municipality) {
    const existing = await req.payload.find({
      collection: 'organizations',
      where: { and: [{ owner: { equals: data.owner } }, { municipality: { equals: data.municipality } }] },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    if (existing.docs.length > 0) {
      throw new APIError('Tenhle uživatel už v obci organizaci má.', 400)
    }
  }

  return data
}

/** An organization created straight from the superadmin panel brings its owner the organizer role
 * in the obec — the other half of the "organizer ⇒ organization" invariant. The role's own hook
 * (ensureOrganization) then finds this organization and leaves it be. Same `req`, same transaction. */
const grantOrganizerRole: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create' || !doc.owner) return doc
  const owner = relId(doc.owner)
  const municipality = relId(doc.municipality)
  const roles = await req.payload.find({
    collection: 'user-roles',
    where: {
      and: [{ user: { equals: owner } }, { municipality: { equals: municipality } }, { role: { equals: 'organizer' } }],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (roles.docs.length === 0) {
    // The obec's own admin runs events as the obec, not as an organization of it.
    const administeredIds = await getAdministeredMunicipalityIds(req.payload, owner)
    if (administeredIds.includes(String(municipality))) {
      throw new APIError('Admin obce pořádá akce za obec — organizaci v ní mít nemůže.', 400)
    }
    await req.payload.create({
      collection: 'user-roles',
      data: { user: owner, municipality, role: 'organizer' },
      overrideAccess: true,
      req,
    })
  }
  return doc
}

/**
 * Deleting an organization ends its owner's organizing in the obec: the organizer role goes with
 * it, and it drops out of every event it co-organizes (with its owner from the derived
 * coOrganizers). Written straight through the adapter so it neither re-runs the events' edit
 * validation (past dates…) nor notifies registrants. The events it runs itself can't be orphaned —
 * like deleting a user, they have to be cancelled or handed over first.
 */
const cleanupOrganization: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { payload } = req
  const organization = await payload.findByID({ collection: 'organizations', id, depth: 0, overrideAccess: true, req })
  const owner = organization.owner ? relId(organization.owner) : null
  const municipality = relId(organization.municipality)

  if (organization.type === MUNICIPALITY_ORGANIZATION_TYPE) {
    // It goes only with the obec itself (Municipalities cleanup) — its events go with the obec too.
    if (!req.context?.deletingMunicipality) {
      throw new APIError('Organizaci obce nejde smazat — patří k obci.', 400)
    }
  } else {
    const runs = await payload.count({
      collection: 'events',
      where: { and: [{ organization: { equals: id } }, notDeleted] },
      overrideAccess: true,
      req,
    })
    if (runs.totalDocs > 0) {
      throw new APIError(
        `Organizace pořádá ${runs.totalDocs} akcí. Nejdřív je zrušte nebo předejte jinému pořadateli, potom půjde organizaci smazat.`,
        400,
      )
    }
  }

  const coOrganized = await payload.find({
    collection: 'events',
    where: { coOrganizations: { contains: id } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    // A finished event's read-time status write (Events deriveFinishedStatus) would rewrite its
    // relations — this organization included — from outside this transaction.
    context: { skipFinishedAutoUpdate: true },
    req,
  })
  for (const event of coOrganized.docs) {
    await payload.db.updateOne({
      collection: 'events',
      id: event.id,
      data: {
        coOrganizations: (event.coOrganizations ?? []).map(relId).filter((orgId) => orgId !== Number(id)),
        coOrganizers: (event.coOrganizers ?? []).map(relId).filter((userId) => userId !== owner),
      },
      req,
    })
  }

  if (owner === null) return
  await payload.delete({
    collection: 'user-roles',
    where: {
      and: [{ user: { equals: owner } }, { municipality: { equals: municipality } }, { role: { equals: 'organizer' } }],
    },
    overrideAccess: true,
    req,
  })
}

/**
 * Makes sure `owner` has their organization in `municipality` — the one invariant everything else
 * leans on: whoever holds "organizer" in an obec organizes there as an organization. Called when
 * the role is granted (UserRoles), so every path to the role is covered. With a name/type (from
 * the approved OrganizerRequest) it sets them, otherwise an existing organization is left as it is
 * and a new one is an "individual" under the owner's own name. A soft-deleted one is revived rather
 * than duplicated.
 */
export async function ensureOrganization(
  req: PayloadRequest,
  args: { owner: number; municipality: number; name?: string | null; type?: OrganizationType | null },
): Promise<void> {
  const { payload } = req
  const existing = await payload.find({
    collection: 'organizations',
    where: { and: [{ owner: { equals: args.owner } }, { municipality: { equals: args.municipality } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  const current = existing.docs[0]
  const name = args.name?.trim() || null
  const type = args.type && isOrganizationType(args.type) ? args.type : null

  if (current) {
    if (!name && !current.deletedAt) return
    await payload.update({
      collection: 'organizations',
      id: current.id,
      data: { ...(name ? { name, type: type ?? current.type } : {}), deletedAt: null },
      overrideAccess: true,
      req,
    })
    return
  }

  let fallbackName: string | null = null
  if (!name) {
    const profile = await payload.find({
      collection: 'profiles',
      where: { user: { equals: args.owner } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    fallbackName = profile.docs[0]?.fullName?.trim() || null
  }

  await payload.create({
    collection: 'organizations',
    data: {
      name: name ?? fallbackName ?? 'Pořadatel',
      type: type ?? 'individual',
      owner: args.owner,
      municipality: args.municipality,
    },
    overrideAccess: true,
    req,
  })
}

/**
 * The obec's own organization — found, or made (named after the obec) if it doesn't have one yet.
 * Every obec gets it when founded (Municipalities), so the create here is only a safety net.
 */
export async function ensureMunicipalityOrganization(req: PayloadRequest, municipalityId: number | string): Promise<number> {
  const existing = await findMunicipalityOrganizationId(req, municipalityId)
  if (existing !== null) return existing
  const municipality = await req.payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const created = await req.payload.create({
    collection: 'organizations',
    data: { name: municipality.name, type: MUNICIPALITY_ORGANIZATION_TYPE, municipality: Number(municipalityId) },
    overrideAccess: true,
    context: { municipalityOrganization: true },
    req,
  })
  ;(req.context?.municipalityOrganizationIds as Map<string, string | null> | undefined)?.set(
    String(municipalityId),
    String(created.id),
  )
  return created.id
}

export async function findMunicipalityOrganizationId(
  req: PayloadRequest,
  municipalityId: number | string,
): Promise<number | null> {
  const found = await req.payload.find({
    collection: 'organizations',
    where: {
      and: [{ municipality: { equals: municipalityId } }, { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  return found.docs[0]?.id ?? null
}

/** Obec id → the id of its own organization, for each of `municipalityIds` that has one. Looked up
 * once per request and obec (event access checks ask for it per event). */
export async function municipalityOrganizationIds(
  req: PayloadRequest,
  municipalityIds: (number | string)[],
): Promise<Map<string, string>> {
  const cache = ((req.context ??= {}).municipalityOrganizationIds ??= new Map()) as Map<string, string | null>
  const missing = [...new Set(municipalityIds.map(String))].filter((id) => !cache.has(id))
  if (missing.length > 0) {
    const found = await req.payload.find({
      collection: 'organizations',
      where: { and: [{ municipality: { in: missing } }, { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }] },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
    for (const id of missing) cache.set(id, null)
    for (const doc of found.docs) cache.set(String(relId(doc.municipality)), String(doc.id))
  }
  const result = new Map<string, string>()
  for (const id of municipalityIds.map(String)) {
    const orgId = cache.get(id)
    if (orgId) result.set(id, orgId)
  }
  return result
}

/** Of `userId`'s organizations, the one in `municipalityId` (live ones only). */
export async function findOrganizationId(
  req: PayloadRequest,
  userId: number | string,
  municipalityId: number | string,
): Promise<number | null> {
  const found = await req.payload.find({
    collection: 'organizations',
    where: {
      and: [{ owner: { equals: userId } }, { municipality: { equals: municipalityId } }, notDeleted],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  return found.docs[0]?.id ?? null
}

/**
 * Who an event is run by: a pub ("Kavárna NMNM"), a club, a single person ("Vycházky pro
 * seniory") — or the obec itself. Spolupořadatelství goes organization to organization — the obec
 * admin adds the café, not the café owner. Each organization belongs to one obec. An organizer's
 * has exactly one owner (the organizer who got the role for it); it's created with the organizer
 * role — its name and type come from the OrganizerRequest the obec approved (see
 * ensureOrganization). The obec's own ("municipality" type) has no owner — its admins act for it —
 * and lives and dies with the obec.
 */
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  labels: {
    singular: 'Organization',
    plural: 'Organizations',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'owner', 'municipality', 'updatedAt'],
  },
  access: {
    // Shown on public event cards/detail as the pořadatel/spolupořadatel.
    read: () => notDeleted,
    // Created alongside the organizer role (ensureOrganization), or by the superadmin — which
    // grants the role in turn (grantOrganizerRole).
    create: platformAdminOnly,
    update: canUpdateOrganization,
    delete: platformAdminOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: ORGANIZATION_NAME_MAX_LENGTH,
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'individual',
      options: [
        ...ORGANIZATION_TYPES.map((t) => ({ label: t.label, value: t.value })),
        { label: 'Obec', value: MUNICIPALITY_ORGANIZATION_TYPE },
      ],
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      // Empty only on the obec's own organization (validateOrganization). Fixed for good: the
      // organizer role, the events it runs and its co-organizations all hang off who owns it
      // where. A different owner or obec is a different organization.
      access: { update: () => false },
      admin: { position: 'sidebar' },
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      access: { update: () => false },
      admin: { position: 'sidebar' },
    },
    // The owner may rename theirs, not withdraw it — that's deleting, which the superadmin does.
    { ...(deletedAtField as DateField), access: { update: platformAdminOnly } },
  ],
  hooks: {
    beforeValidate: [validateOrganization],
    afterChange: [grantOrganizerRole],
    beforeDelete: [cleanupOrganization],
  },
  timestamps: true,
}
