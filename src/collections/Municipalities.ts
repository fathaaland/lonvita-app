import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { ensureMunicipalityOrganization, findMunicipalityOrganizationId } from './Organizations'

/** A municipality, once founded, can't be founded again — matched case-insensitively/trimmed
 * so "Blansko" and "blansko " are treated as the same obec (brief item 1: superadmin shouldn't
 * be able to re-create an obec that already exists). */
const preventDuplicateName: CollectionBeforeValidateHook = async ({ data, req, operation, originalDoc }) => {
  if (!data?.name) return data

  const name = data.name.trim()
  if (operation === 'update' && originalDoc?.name?.trim().toLowerCase() === name.toLowerCase()) {
    return data
  }

  // `like` is Postgres ILIKE (case-insensitive contains) — narrows the candidates; the exact
  // (trimmed, case-insensitive) comparison below rules out unrelated partial matches.
  const candidates = await req.payload.find({
    collection: 'municipalities',
    where: { name: { like: name } },
    depth: 0,
    limit: 50,
    overrideAccess: true,
  })
  const duplicate = candidates.docs.some(
    (doc) => doc.name.trim().toLowerCase() === name.toLowerCase() && doc.id !== originalDoc?.id,
  )
  if (duplicate) {
    throw new Error(`Obec „${name}“ už existuje.`)
  }

  return { ...data, name }
}

/** Picking an adminUser directly on the obec (Payload admin UI) grants the matching
 * "municipality_admin" user-role, so both places agree. The reverse direction (superadmin panel
 * grants a role -> adminUser) lives in UserRoles.ts and sets `skipAdminUserSync` to stop the loop. */
const grantRoleForAdminUser: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if (context?.skipAdminUserSync) return doc

  const userId = typeof doc.adminUser === 'object' ? doc.adminUser?.id : doc.adminUser
  const previousUserId = typeof previousDoc?.adminUser === 'object' ? previousDoc?.adminUser?.id : previousDoc?.adminUser
  if (!userId || userId === previousUserId) return doc

  const existing = await req.payload.find({
    collection: 'user-roles',
    where: {
      and: [{ user: { equals: userId } }, { municipality: { equals: doc.id } }, { role: { equals: 'municipality_admin' } }],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (existing.docs.length === 0) {
    await req.payload.create({
      collection: 'user-roles',
      data: { user: userId, municipality: doc.id, role: 'municipality_admin' },
      overrideAccess: true,
      req,
    })
  }
  return doc
}

/** Every obec runs its own events as its organization (Organizations, type "municipality") —
 * founded with it, and renamed along with it unless its admins gave it a name of its own. */
const syncMunicipalityOrganization: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation === 'create') {
    await ensureMunicipalityOrganization(req, doc.id)
    return doc
  }
  if (!previousDoc?.name || previousDoc.name === doc.name) return doc
  const organizationId = await findMunicipalityOrganizationId(req, doc.id)
  if (organizationId === null) {
    await ensureMunicipalityOrganization(req, doc.id)
    return doc
  }
  const organization = await req.payload.findByID({
    collection: 'organizations',
    id: organizationId,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (organization.name === previousDoc.name) {
    await req.payload.update({
      collection: 'organizations',
      id: organizationId,
      data: { name: doc.name },
      overrideAccess: true,
      req,
    })
  }
  return doc
}

/** The obec's organization goes with it — the one way it can be deleted. */
const deleteMunicipalityOrganization: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const organizationId = await findMunicipalityOrganizationId(req, id)
  if (organizationId === null) return
  await req.payload.delete({
    collection: 'organizations',
    id: organizationId,
    overrideAccess: true,
    context: { deletingMunicipality: true },
    req,
  })
}

/** A municipality admin may update their own municipality's settings (e.g. rulesForCreation,
 * brief §3 "Nastavení" tab) — a platform admin can update any. Distinct from create/delete,
 * which stay platform-admin-only (founding/removing an obec isn't a municipality_admin power). */
const canUpdateOwnMunicipality: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length === 0) return false
  return { id: { in: administeredIds } }
}

export const Municipalities: CollectionConfig = {
  slug: 'municipalities',
  labels: {
    singular: 'Municipality',
    plural: 'Municipalities',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => user?.role === 'admin',
    update: canUpdateOwnMunicipality,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Municipality Name',
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'lat',
      type: 'number',
      required: true,
      admin: {
        description:
          'Brief §4 "poloha je mandatory field" — plots this obec on the municipality-switcher map (brief §4/§7 "mapka jako v Projects/eduard-app").',
      },
    },
    {
      name: 'lng',
      type: 'number',
      required: true,
    },
    {
      name: 'adminUser',
      type: 'relationship',
      relationTo: 'users',
      label: 'Municipality Admin',
      // Setting it grants a municipality_admin role (grantRoleForAdminUser) — platform admin only,
      // otherwise a municipality admin could hand that role to anyone via their own obec settings.
      access: { update: ({ req: { user } }) => user?.role === 'admin' },
      admin: {
        description:
          'The user who administers this municipality. Kept in sync with "municipality_admin" user-roles (the most recently granted one).',
        position: 'sidebar',
      },
    },
    {
      name: 'eventRadiusKm',
      type: 'number',
      required: true,
      defaultValue: 15,
      admin: {
        description:
          'Maximální vzdálenost (km) mezi středem obce (lat/lng výše) a místem konání akce. Akce mimo tento okruh nejde založit ani upravit — brání přiřazení akce z jiného města k této obci.',
      },
    },
    {
      name: 'rulesForCreation',
      type: 'select',
      required: true,
      defaultValue: 'approved_organizers',
      options: [
        { label: 'Akce může zakládat pouze obec sama', value: 'municipality_only' },
        { label: 'Obec schvaluje každou žádost o roli organizátora (výchozí)', value: 'approved_organizers' },
      ],
      admin: {
        description:
          'Brief §3 "Pravidla pro vznik akcí" — controls who may create events for this municipality (see Events.access.create). A signed-out visitor is always read-only regardless of this setting. The former "anyone can create" option was removed for security (task 5) — an obec admin must never be able to create events outside their own obec, which an open-to-anyone mode elsewhere would have allowed.',
      },
    },
  ],
  hooks: {
    beforeValidate: [preventDuplicateName],
    afterChange: [grantRoleForAdminUser, syncMunicipalityOrganization],
    beforeDelete: [deleteMunicipalityOrganization],
  },
  timestamps: true,
}
