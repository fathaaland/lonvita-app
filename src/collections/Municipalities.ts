import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { ensureMunicipalityOrganization, findMunicipalityOrganizationId } from './Organizations'
import { auditDeletion } from './shared/auditLog'
import { notDeleted } from './shared/softDelete'

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

/**
 * Deleting an obec takes everything that belonged to it along — its events (each with its
 * registrations, photos and invitations, Events cleanupEventRelations), roles, organizations,
 * requests, complaints, pool invitations and areas; every one of them points at the obec through a
 * NOT NULL column. Its residents keep their accounts, "bez obce" (the database clears their
 * profile's obec). Refused while an event ahead still stands — cancelling it tells the people
 * signed up, a deleted obec wouldn't. Quietly otherwise: `deletingMunicipality` keeps the hooks
 * from telling anyone their role or event went.
 */
const deleteMunicipalityData: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { payload } = req
  const upcoming = await payload.count({
    collection: 'events',
    where: {
      and: [
        { municipality: { equals: id } },
        { status: { not_equals: 'cancelled' } },
        notDeleted,
        { dateTime: { greater_than: new Date().toISOString() } },
      ],
    },
    overrideAccess: true,
    req,
  })
  if (upcoming.totalDocs > 0) {
    throw new APIError(
      `Obec má ${upcoming.totalDocs} nadcházejících akcí. Nejdřív je zrušte (přihlášení se to dozvědí), potom půjde obec smazat.`,
      400,
    )
  }

  const context = { deletingMunicipality: true }
  const ofObec = { municipality: { equals: id } }
  // Sequential — one transaction (`req`). Events first: the requests and complaints point at them too.
  await payload.delete({ collection: 'events', where: ofObec, overrideAccess: true, context, req })
  for (const collection of [
    'organizer-requests',
    'co-organizing-requests',
    'event-deletion-requests',
    'review-complaints',
    'pool-invitations',
    // Candidates point at the sources — they go first.
    'event-import-candidates',
    'event-sources',
    'user-roles',
  ] as const) {
    await payload.delete({ collection, where: ofObec, overrideAccess: true, context, req })
  }
  // The obec's own organization last — the others' cleanup no longer finds anything to do.
  const municipalityOrganizationId = await findMunicipalityOrganizationId(req, id)
  await payload.delete({
    collection: 'organizations',
    where: municipalityOrganizationId === null ? ofObec : { and: [ofObec, { id: { not_equals: municipalityOrganizationId } }] },
    overrideAccess: true,
    context,
    req,
  })
  if (municipalityOrganizationId !== null) {
    await payload.delete({ collection: 'organizations', id: municipalityOrganizationId, overrideAccess: true, context, req })
  }
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
    afterChange: [syncMunicipalityOrganization],
    beforeDelete: [deleteMunicipalityData],
    // Takes everything of the obec along (deleteMunicipalityData) — one entry for all of it.
    afterDelete: [auditDeletion<{ name?: string }>((doc) => ({ metadata: { name: doc.name } }))],
  },
  timestamps: true,
}
