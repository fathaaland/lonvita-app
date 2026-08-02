import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const Registrations: CollectionConfig = {
  slug: 'registrations',
  labels: {
    singular: 'Registration',
    plural: 'Registrations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['event', 'profile', 'status', 'attendanceStatus', 'updatedAt'],
  },
  access: {
    read: isLoggedIn,
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
    },
    {
      name: 'profile',
      type: 'relationship',
      relationTo: 'profiles',
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
        { label: 'Declined', value: 'declined' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        description: '"Smí přijít" — whether the registration itself is allowed, not whether they attended.',
      },
    },
    {
      name: 'attendanceStatus',
      type: 'select',
      defaultValue: 'not_marked',
      options: [
        { label: 'Not marked', value: 'not_marked' },
        { label: 'Attended', value: 'attended' },
        { label: 'No-show', value: 'no_show' },
      ],
      admin: {
        description: 'What actually happened — set by the organizer after the event.',
      },
    },
    {
      name: 'attendanceMarkedBy',
      type: 'relationship',
      relationTo: 'profiles',
      admin: {
        description: 'The organizer profile that marked attendance.',
      },
    },
    {
      name: 'paymentStatus',
      type: 'select',
      defaultValue: 'not_required',
      options: [
        { label: 'Not required', value: 'not_required' },
        { label: 'Pending', value: 'pending' },
        { label: 'Paid', value: 'paid' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    {
      name: 'deletedAt',
      type: 'date',
      admin: {
        description: 'Soft-delete marker — preserves attendance history.',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
