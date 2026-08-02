import type { CollectionConfig } from 'payload'

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
    update: ({ req: { user } }) => user?.role === 'admin',
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
      name: 'rulesForCreation',
      type: 'textarea',
      label: 'Rules for Event Creation',
      admin: {
        description: 'Who is allowed to create events in this municipality.',
      },
    },
    {
      name: 'adminUser',
      type: 'relationship',
      relationTo: 'users',
      label: 'Municipality Admin',
      admin: {
        description: 'The user who administers this municipality.',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
