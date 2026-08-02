import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const Profiles: CollectionConfig = {
  slug: 'profiles',
  labels: {
    singular: 'Profile',
    plural: 'Profiles',
  },
  admin: {
    useAsTitle: 'fullName',
    defaultColumns: ['fullName', 'municipality', 'updatedAt'],
  },
  access: {
    read: isLoggedIn,
    create: isLoggedIn,
    update: ({ req: { user } }) => {
      if (!user) return false
      return { user: { equals: user.id } }
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      return { user: { equals: user.id } }
    },
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      unique: true,
      admin: {
        description: '1:1 link to the account this profile belongs to.',
      },
    },
    {
      name: 'fullName',
      type: 'text',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      admin: {
        description: "The user's home municipality.",
      },
    },
    {
      name: 'payoutIban',
      type: 'text',
      label: 'Payout IBAN',
      admin: {
        description: 'Organizer payout account. Only visible/editable by the profile owner.',
      },
      access: {
        read: ({ req: { user }, doc }) => Boolean(user && doc?.user === user.id),
        update: ({ req: { user }, doc }) => Boolean(user && doc?.user === user.id),
      },
    },
  ],
  timestamps: true,
}
