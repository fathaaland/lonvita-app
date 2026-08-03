import type { CollectionConfig, Where } from 'payload'

import { isLoggedIn } from './access/shared'

export const EventMedia: CollectionConfig = {
  slug: 'event-media',
  labels: {
    singular: 'Event Photo',
    plural: 'Event Photos',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['event', 'visibility', 'uploadedBy', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }): Where => {
      if (!user) {
        return { or: [{ visibility: { equals: 'public' } }] }
      }
      return {
        or: [
          { visibility: { equals: 'public' } },
          { visibility: { equals: 'municipality' } },
          { uploadedBy: { equals: user.id } },
        ],
      }
    },
    create: isLoggedIn,
    update: ({ req: { user } }) => {
      if (!user) return false
      return { uploadedBy: { equals: user.id } }
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      return { uploadedBy: { equals: user.id } }
    },
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
    },
    {
      name: 'media',
      type: 'relationship',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'uploadedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'municipality',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Municipality', value: 'municipality' },
        { label: 'Public', value: 'public' },
      ],
    },
  ],
  timestamps: true,
}
