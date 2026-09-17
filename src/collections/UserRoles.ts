import type { CollectionConfig, PayloadRequest } from 'payload'

import { isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'
import { writeAuditLog } from './shared/auditLog'

const relId = (value: number | { id: number }): number =>
  typeof value === 'object' ? value.id : value

/** Municipalities.adminUser mirrors the most recently granted "municipality_admin" role for that
 * obec (null once none is left) — the superadmin panel only ever writes user-roles rows, so without
 * this the obec's own adminUser column stayed empty. `req` keeps it in the same transaction as the
 * grant/revoke; `skipAdminUserSync` stops Municipalities' own hook from granting the role back. */
async function syncMunicipalityAdminUser(
  req: PayloadRequest,
  municipalityId: number,
): Promise<void> {
  const latest = await req.payload.find({
    collection: 'user-roles',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { role: { equals: 'municipality_admin' } },
      ],
    },
    sort: '-createdAt',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  await req.payload.update({
    collection: 'municipalities',
    id: municipalityId,
    data: { adminUser: latest.docs[0] ? relId(latest.docs[0].user) : null },
    overrideAccess: true,
    context: { skipAdminUserSync: true },
    req,
  })
}

export const UserRoles: CollectionConfig = {
  slug: 'user-roles',
  labels: {
    singular: 'User Role',
    plural: 'User Roles',
  },
  admin: {
    useAsTitle: 'role',
    defaultColumns: ['user', 'role', 'municipality', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { user: { equals: user.id } }
    },
    create: isPlatformOrMunicipalityAdmin(),
    update: isPlatformOrMunicipalityAdmin(),
    delete: isPlatformOrMunicipalityAdmin(),
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      admin: {
        description: 'The municipality this role applies to.',
      },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      options: [
        { label: 'Participant', value: 'participant' },
        { label: 'Municipality Admin', value: 'municipality_admin' },
        { label: 'Organizer', value: 'organizer' },
        {
          label: 'Prescriber (plán)',
          value: 'prescriber',
        },
      ],
      admin: {
        description:
          'Enum matches ERD §0.2 pilot roles, plus "organizer" (brief §4). A user can hold the same role in several municipalities at once — organizers and volunteers aren\'t tied to one town (brief §8 "Působení jednoho člověka napříč víc obcemi"). "prescriber" is a reserved slot for the intervention layer — not wired to any workflow yet (see brief §B).',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.user || !data?.role || !data?.municipality) return data

        const userId = data.user
        const role = data.role
        const municipality = data.municipality

        // Scoped to (user, role, municipality), not just (user, role) — the same person can
        // hold "organizer" (or, in principle, any role) in several municipalities at once.
        if (
          operation === 'update' &&
          originalDoc?.user === userId &&
          originalDoc?.role === role &&
          originalDoc?.municipality === municipality
        ) {
          return data
        }

        const existing = await req.payload.find({
          collection: 'user-roles',
          where: {
            and: [
              { user: { equals: userId } },
              { role: { equals: role } },
              { municipality: { equals: municipality } },
            ],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error(`This user already has the "${role}" role in this municipality.`)
        }

        // An obec may have several municipality_admin users, but an admin may only administer
        // one obec at a time — unlike "organizer" above, this role isn't meant to span towns.
        if (role === 'municipality_admin') {
          const elsewhere = await req.payload.find({
            collection: 'user-roles',
            where: {
              and: [
                { user: { equals: userId } },
                { role: { equals: 'municipality_admin' } },
                { municipality: { not_equals: municipality } },
              ],
            },
            depth: 0,
            limit: 1,
          })

          if (elsewhere.docs.length > 0) {
            throw new Error('This user is already the municipality admin of a different obec.')
          }
        }

        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        const municipalityIds = new Set<number>()
        if (doc.role === 'municipality_admin') municipalityIds.add(relId(doc.municipality))
        if (previousDoc?.role === 'municipality_admin')
          municipalityIds.add(relId(previousDoc.municipality))
        for (const municipalityId of municipalityIds) {
          await syncMunicipalityAdminUser(req, municipalityId)
        }
        return doc
      },
      ({ doc, req, operation }) => {
        if (operation !== 'create') return
        writeAuditLog(req.payload, {
          action: 'user-roles.grant',
          actor: req.user?.id ?? null,
          targetCollection: 'user-roles',
          targetId: doc.id,
          municipality:
            typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality,
          metadata: { grantedTo: doc.user, role: doc.role },
        })
      },
    ],
    // Brief §3 "kdo oprávnění uděluje, ten ho může kdykoliv i zpětně odebrat" — grants are
    // audited on create above; this is the matching trail for revocation (a hard DELETE, see
    // revokeCommunityRole in superadmin-queries.ts), which previously left no audit record.
    afterDelete: [
      async ({ doc, req }) => {
        if (doc.role === 'municipality_admin')
          await syncMunicipalityAdminUser(req, relId(doc.municipality))
        return doc
      },
      ({ doc, req }) => {
        writeAuditLog(req.payload, {
          action: 'user-roles.revoke',
          actor: req.user?.id ?? null,
          targetCollection: 'user-roles',
          targetId: doc.id,
          municipality:
            typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality,
          metadata: { revokedFrom: doc.user, role: doc.role },
        })
      },
    ],
  },
  timestamps: true,
}
