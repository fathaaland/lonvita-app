import type { CollectionConfig } from 'payload'

import { isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'
import { writeAuditLog } from './shared/auditLog'

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
        {
          label: 'Prescriber (plán)',
          value: 'prescriber',
        },
      ],
      admin: {
        description:
          'Enum matches ERD §0.2 pilot roles. "prescriber" is a reserved slot for the intervention layer — not wired to any workflow yet (see brief §B).',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.user || !data?.role) return data

        const userId = data.user
        const role = data.role

        if (operation === 'update' && originalDoc?.user === userId && originalDoc?.role === role) {
          return data
        }

        const existing = await req.payload.find({
          collection: 'user-roles',
          where: {
            and: [{ user: { equals: userId } }, { role: { equals: role } }],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error(`This user already has the "${role}" role.`)
        }

        return data
      },
    ],
    afterChange: [
      ({ doc, req, operation }) => {
        if (operation !== 'create') return
        writeAuditLog(req.payload, {
          action: 'user-roles.grant',
          actor: req.user?.id ?? null,
          targetCollection: 'user-roles',
          targetId: doc.id,
          municipality: typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality,
          metadata: { grantedTo: doc.user, role: doc.role },
        })
      },
    ],
  },
  timestamps: true,
}
