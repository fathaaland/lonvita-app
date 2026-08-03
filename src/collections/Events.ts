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
      name: 'lat',
      type: 'number',
    },
    {
      name: 'lng',
      type: 'number',
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
      relationTo: 'users',
      required: true,
      admin: {
        description: 'The user organizing this event.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Full', value: 'full' },
        { label: 'Finished', value: 'finished' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
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
      name: 'cancellationPolicy',
      type: 'select',
      required: true,
      defaultValue: 'cancel_48h',
      options: [
        { label: 'No cancellation', value: 'none' },
        { label: 'Up to 24h before', value: 'cancel_24h' },
        { label: 'Up to 48h before', value: 'cancel_48h' },
        { label: 'Up to 7 days before', value: 'cancel_7d' },
      ],
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
