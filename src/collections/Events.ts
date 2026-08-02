import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const Events: CollectionConfig = {
  slug: 'events',
  labels: {
    singular: 'Event',
    plural: 'Events',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'municipality', 'dateTime', 'capacity', 'updatedAt'],
  },
  access: {
    // Public marketplace listing — the frontend filters by municipality itself
    // (matches the existing Index.tsx query pattern: .eq('municipality_id', muniId)).
    read: () => true,
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
    },
    {
      name: 'dateTime',
      type: 'date',
      required: true,
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'locationText',
      type: 'text',
      required: true,
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'organizer',
      type: 'relationship',
      relationTo: 'profiles',
      required: true,
      admin: {
        description: 'The profile organizing this event.',
      },
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'event-categories',
      required: true,
    },
    {
      name: 'image',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        description: 'Cover image shown in event listings.',
      },
    },
    {
      name: 'isPaid',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'priceCents',
      type: 'number',
      min: 0,
      admin: {
        description: 'Price in the smallest currency unit (e.g. haléře), used with Stripe.',
        condition: (data) => Boolean(data?.isPaid),
      },
    },
    {
      name: 'deletedAt',
      type: 'date',
      admin: {
        description: 'Soft-delete marker — preserves attendance history when an event is removed.',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
