import type { CollectionConfig } from 'payload'

const platformAdminOnly = ({ req: { user } }: { req: { user: { role?: string } | null } }) =>
  user?.role === 'admin'

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
    // One list for the whole platform — every event and profile points at it. Nothing in the app
    // writes it (the seed goes through the Local API); renaming or removing a category is the
    // platform admin's call, never any signed-in user's.
    create: platformAdminOnly,
    update: platformAdminOnly,
    delete: platformAdminOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
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
