import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeReadHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Field,
  FieldAccess,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { ensureMunicipalityOrganization, findMunicipalityOrganizationId } from './Organizations'
import { auditDeletion, writeAuditLog } from './shared/auditLog'
import { notDeleted } from './shared/softDelete'
import { PACKAGE_KEYS, PACKAGE_LABELS } from '@/lib/billing/catalog'

/** A municipality, once founded, can't be founded again — matched case-insensitively/trimmed
 * so "Blansko" and "blansko " are treated as the same obec (brief item 1: superadmin shouldn't
 * be able to re-create an obec that already exists). */
const preventDuplicateName: CollectionBeforeValidateHook = async ({
  data,
  req,
  operation,
  originalDoc,
}) => {
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
const syncMunicipalityOrganization: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
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
    // Candidates and runs point at the sources — they go first.
    'event-import-candidates',
    'import-runs',
    'event-sources',
    'user-roles',
    // Its monthly user counts (billing) — the obec is gone, so are they.
    'active-user-snapshots',
  ] as const) {
    await payload.delete({ collection, where: ofObec, overrideAccess: true, context, req })
  }
  // The obec's own organization last — the others' cleanup no longer finds anything to do.
  const municipalityOrganizationId = await findMunicipalityOrganizationId(req, id)
  await payload.delete({
    collection: 'organizations',
    where:
      municipalityOrganizationId === null
        ? ofObec
        : { and: [ofObec, { id: { not_equals: municipalityOrganizationId } }] },
    overrideAccess: true,
    context,
    req,
  })
  if (municipalityOrganizationId !== null) {
    await payload.delete({
      collection: 'organizations',
      id: municipalityOrganizationId,
      overrideAccess: true,
      context,
      req,
    })
  }
}

/** A municipality admin may update their own municipality's settings (e.g. rulesForCreation,
 * brief §3 "Nastavení" tab) — a platform admin can update any. Distinct from create/delete,
 * which stay platform-admin-only (founding/removing an obec isn't a municipality_admin power). */
const canUpdateOwnMunicipality: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id, req)
  if (administeredIds.length === 0) return false
  return { id: { in: administeredIds } }
}

/** Set and read by the platform alone — an obec admin can update the rest of their obec. */
const platformAdmin: FieldAccess = ({ req: { user } }) => user?.role === 'admin'
const platformOnlyField = { read: platformAdmin, create: platformAdmin, update: platformAdmin }
/** Whether the obec has a service is no secret — the app leaves out what it doesn't pay for (no
 * "you'll get an SMS" without SMS); only the platform switches it. */
const serviceSwitchField = { create: platformAdmin, update: platformAdmin }

/**
 * What the obec has bought (Balíčky služeb, lib/billing) — the yearly licence, the SMS and scraping
 * packages, and whether it's suspended (doesn't pay: SMS and scraping stop, the community module
 * stays). Set by the platform alone in the superadmin panel; the obec's admins see their package
 * and use through /api/municipalities/:id/services, never the fields themselves.
 */
const billingFields: Field[] = [
  {
    name: 'billingStatus',
    type: 'select',
    defaultValue: 'active',
    options: [
      { label: 'Aktivní', value: 'active' },
      { label: 'Pozastaveno', value: 'suspended' },
    ],
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  { name: 'billingNote', type: 'textarea', access: platformOnlyField, admin: { position: 'sidebar' } },
  // The licence year — the SMS quota counts within it. Empty: the calendar year.
  { name: 'licencePeriodStart', type: 'date', access: platformOnlyField, admin: { position: 'sidebar' } },
  {
    name: 'licencePeriodEnd',
    type: 'date',
    access: platformOnlyField,
    admin: { position: 'sidebar' },
    // An end on or before the start is a period nothing falls in — the obec's SMS would never count.
    validate: (value: unknown, { siblingData }: { siblingData: { licencePeriodStart?: unknown } }) => {
      const start = siblingData?.licencePeriodStart
      if (!value || !start) return true
      return new Date(value as string).getTime() > new Date(start as string).getTime()
        ? true
        : 'Konec licenčního období musí být po jeho začátku.'
    },
  },
  {
    // The band set by hand (Žďár, exceptions, or fixed at the yearly invoice). Empty: computed from
    // the average of the last three monthly snapshots of its users.
    name: 'licenceTier',
    type: 'number',
    min: 0,
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  // An individual yearly price instead of the band's (Žďár: 120 000).
  { name: 'licenceCustomYearlyCzk', type: 'number', min: 0, access: platformOnlyField, admin: { position: 'sidebar' } },
  // An individual one-off implementation fee instead of the price list's.
  { name: 'implementationFeeCzk', type: 'number', min: 0, access: platformOnlyField, admin: { position: 'sidebar' } },
  {
    name: 'smsPackage',
    type: 'select',
    defaultValue: 's',
    options: PACKAGE_KEYS.map((k) => ({ label: PACKAGE_LABELS[k], value: k })),
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  // A yearly quota of SMS parts other than the package's.
  { name: 'smsQuotaOverride', type: 'number', min: 0, access: platformOnlyField, admin: { position: 'sidebar' } },
  {
    // Past the quota: on — keep texting (billed at the year's end); off — e-mail instead.
    name: 'smsOverageAllowed',
    type: 'checkbox',
    defaultValue: false,
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  {
    // Which usage alert (80 / 100 %) its admins already got, and for which licence year.
    name: 'smsAlertState',
    type: 'text',
    access: { read: platformAdmin, create: () => false, update: () => false },
    admin: { hidden: true },
  },
  {
    name: 'scrapingPackage',
    type: 'select',
    defaultValue: 's',
    options: PACKAGE_KEYS.map((k) => ({ label: PACKAGE_LABELS[k], value: k })),
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  // How many sources it may have, other than the package's.
  { name: 'scrapingMaxSourcesOverride', type: 'number', min: 0, access: platformOnlyField, admin: { position: 'sidebar' } },
  {
    // The weekly slot agreed with the obec — ISO weekday (1 = Monday) and the hour, Prague time.
    name: 'scrapingSlotDay',
    type: 'number',
    min: 1,
    max: 7,
    defaultValue: 1,
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  {
    name: 'scrapingSlotHour',
    type: 'number',
    min: 0,
    max: 23,
    defaultValue: 2,
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  {
    // Twice a week: the slot and again three days later.
    name: 'scrapingFrequency',
    type: 'select',
    defaultValue: 'weekly',
    options: [
      { label: '1× týdně', value: 'weekly' },
      { label: '2× týdně', value: 'twice_weekly' },
    ],
    access: platformOnlyField,
    admin: { position: 'sidebar' },
  },
  // Input tokens one run may use, other than the price list's safety net.
  { name: 'scrapingMaxInputTokensOverride', type: 'number', min: 0, access: platformOnlyField, admin: { position: 'sidebar' } },
]

/**
 * A suspended obec (doesn't pay) has no SMS nor import, so the app mustn't promise them — but why is
 * the platform's business. Everyone but a platform admin reads both switches off; the stored values
 * stay, so lifting the suspension brings the packages back as they were. Before field access strips
 * billingStatus from the doc.
 */
const hideSuspendedServices: CollectionBeforeReadHook = ({ doc, req }) => {
  if (doc?.billingStatus !== 'suspended' || req.user?.role === 'admin') return doc
  return { ...doc, smsEnabled: false, importAiEnabled: false }
}

/** What the platform changed of an obec's services — on the record: who, when, from what to what. */
export const BILLING_AUDITED_FIELDS = [
  'smsEnabled',
  'importAiEnabled',
  ...billingFields.map((f) => ('name' in f ? f.name : '')).filter((n) => n && n !== 'smsAlertState'),
] as const

const auditBillingChange: CollectionAfterChangeHook = ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !req.user) return doc
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of BILLING_AUDITED_FIELDS) {
    const from = previousDoc?.[field] ?? null
    const to = doc[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  if (Object.keys(changes).length === 0) return doc
  writeAuditLog(req.payload, {
    action: 'municipalities.billing-change',
    actor: Number(req.user.id),
    targetCollection: 'municipalities',
    targetId: doc.id,
    municipality: doc.id,
    metadata: { changes },
    source: req,
  })
  return doc
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
          'Smluvní okruh (km) kolem středu obce (lat/lng výše), ve kterém má obec a její pořadatelé pořádat akce. Aplikace ho nevynucuje — akci lze založit kdekoli; zveřejněná akce mimo okruh se ukáže na mapě obce v superadminu a pošle alert platformě. Import akcí z webu podle něj hledá místa konání.',
      },
    },
    {
      name: 'rulesForCreation',
      type: 'select',
      required: true,
      defaultValue: 'approved_organizers',
      options: [
        { label: 'Akce může zakládat pouze obec sama', value: 'municipality_only' },
        {
          label: 'Obec schvaluje každou žádost o roli organizátora (výchozí)',
          value: 'approved_organizers',
        },
      ],
      admin: {
        description:
          'Brief §3 "Pravidla pro vznik akcí" — controls who may create events for this municipality (see Events.access.create). A signed-out visitor is always read-only regardless of this setting. The former "anyone can create" option was removed for security (task 5) — an obec admin must never be able to create events outside their own obec, which an open-to-anyone mode elsewhere would have allowed.',
      },
    },
    // Whether the obec has the SMS and the scraping add-on (Balíčky služeb) — readable by all, so the
    // app promises only what it has; their packages and limits are in billingFields.
    {
      name: 'smsEnabled',
      type: 'checkbox',
      defaultValue: false,
      access: serviceSwitchField,
      admin: { position: 'sidebar' },
    },
    {
      // Off: its sources are read from iCal and schema.org only, which cost nothing.
      name: 'importAiEnabled',
      type: 'checkbox',
      defaultValue: false,
      access: serviceSwitchField,
      admin: { position: 'sidebar' },
    },
    ...billingFields,
  ],
  hooks: {
    beforeValidate: [preventDuplicateName],
    beforeRead: [hideSuspendedServices],
    afterChange: [syncMunicipalityOrganization, auditBillingChange],
    beforeDelete: [deleteMunicipalityData],
    // Takes everything of the obec along (deleteMunicipalityData) — one entry for all of it.
    afterDelete: [auditDeletion<{ name?: string }>((doc) => ({ metadata: { name: doc.name } }))],
  },
  timestamps: true,
}
