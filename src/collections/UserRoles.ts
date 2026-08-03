import type { CollectionConfig } from 'payload'

import { isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'

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
        { label: 'Organizer', value: 'organizer' },
        { label: 'Admin', value: 'admin' },
      ],
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
  },
  timestamps: true,
}
