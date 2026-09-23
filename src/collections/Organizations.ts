import type { Access, CollectionBeforeValidateHook, CollectionConfig, PayloadRequest, Where } from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { deletedAtField, notDeleted } from './shared/softDelete'
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
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

const validateOrganization: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (!data) return data

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
 * Who an event is run by, besides the obec itself: a pub ("Kavárna NMNM"), a club, or a single
 * person ("Vycházky pro seniory"). Spolupořadatelství goes organization to organization — the obec
 * admin adds the café, not the café owner. Each organization has exactly one owner (the organizer
 * who got the role for it) and belongs to one obec; it's created with the organizer role — its
 * name and type come from the OrganizerRequest the obec approved (see ensureOrganization).
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
    // Only ever created alongside the organizer role (ensureOrganization, overrideAccess).
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
      options: ORGANIZATION_TYPES.map((t) => ({ label: t.label, value: t.value })),
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: { update: platformAdminOnly },
      admin: { position: 'sidebar' },
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      access: { update: platformAdminOnly },
      admin: { position: 'sidebar' },
    },
    deletedAtField,
  ],
  hooks: {
    beforeValidate: [validateOrganization],
  },
  timestamps: true,
}
