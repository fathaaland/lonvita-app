import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

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
    read: isLoggedIn,
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
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
      name: 'message',
      type: 'textarea',
      admin: {
        description: 'Optional note from the requester about why they want to organize events.',
      },
    },
  ],
  timestamps: true,
}
