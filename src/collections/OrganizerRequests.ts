import type { CollectionConfig } from 'payload'

import { isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'

export const OrganizerRequests: CollectionConfig = {
  slug: 'organizer-requests',
  labels: {
    singular: 'Organizer Request',
    plural: 'Organizer Requests',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'municipality', 'status', 'updatedAt'],
  },
  access: {
    read: async (args) => {
      const { req } = args
      if (!req.user) return false
      if (req.user.role === 'admin') return true
      const adminAccess = await isPlatformOrMunicipalityAdmin()(args)
      if (adminAccess) return adminAccess
      return { user: { equals: req.user.id } }
    },
    create: isLoggedIn,
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
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: {
        description: 'Approving a request should create a matching User Role of "organizer".',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      admin: {
        description: 'Note from the requester about why they want to organize events.',
      },
    },
    {
      name: 'decidedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
    {
      name: 'decidedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
    },
  ],
  timestamps: true,
}
