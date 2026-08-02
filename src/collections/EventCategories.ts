import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const EventCategories: CollectionConfig = {
  slug: 'event-categories',
  labels: {
    singular: 'Event Category',
    plural: 'Event Categories',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'icon', 'color'],
  },
  access: {
    read: () => true,
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Category Name',
      admin: {
        description: 'e.g. Kultura, Příroda, Vzdělávání',
      },
    },
    {
      name: 'icon',
      type: 'text',
      admin: {
        description: 'Icon identifier used by the frontend (e.g. a lucide-react icon name).',
      },
    },
    {
      name: 'color',
      type: 'text',
      admin: {
        description: 'Color used to render this category in the app (hex or design token).',
      },
    },
  ],
  timestamps: true,
}
