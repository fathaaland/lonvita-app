import type { CollectionConfig } from 'payload'

/**
 * How many users an obec had in a month (lib/billing/active-users) — its licence band is the average
 * of the last three. Taken by the worker on the 1st of every month, or by the superadmin by hand; one
 * row per obec and month (a second one that month overwrites it). Written only server-side.
 */
export const ActiveUserSnapshots: CollectionConfig = {
  slug: 'active-user-snapshots',
  labels: { singular: 'Active User Snapshot', plural: 'Active User Snapshots' },
  admin: {
    useAsTitle: 'month',
    defaultColumns: ['month', 'municipality', 'activeUsers', 'takenAt'],
  },
  defaultSort: '-month',
  access: {
    read: ({ req: { user } }) => user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      index: true,
    },
    // "2026-11"
    { name: 'month', type: 'text', required: true, index: true },
    { name: 'activeUsers', type: 'number', required: true, min: 0 },
    { name: 'takenAt', type: 'date', required: true },
    // Empty: the monthly job.
    { name: 'takenBy', type: 'relationship', relationTo: 'users' },
  ],
}
