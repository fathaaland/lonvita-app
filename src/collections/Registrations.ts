import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'
import { deletedAtField, adminOnlyDelete, notDeleted } from './shared/softDelete'

export const Registrations: CollectionConfig = {
  slug: 'registrations',
  labels: {
    singular: 'Registration',
    plural: 'Registrations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['event', 'user', 'status', 'paymentStatus', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => (user ? notDeleted : false),
    create: isLoggedIn,
    update: isLoggedIn,
    delete: adminOnlyDelete,
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending payment', value: 'pending_payment' },
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
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
        { label: 'Excused', value: 'excused' },
      ],
      admin: {
        description: 'What actually happened — set by the organizer after the event, on the manage-event page.',
      },
    },
    {
      name: 'attendanceMarkedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
    {
      name: 'attendanceMarkedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'The organizer who marked attendance.',
        position: 'sidebar',
      },
    },
    {
      name: 'attendanceNote',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      defaultValue: 'none',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Paid', value: 'paid' },
        { label: 'Refunded', value: 'refunded' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'stripeSessionId',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    {
      name: 'stripePaymentIntentId',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    {
      name: 'amountPaidCents',
      type: 'number',
      admin: { position: 'sidebar' },
    },
    {
      name: 'refundedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
    deletedAtField,
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.event || !data?.user) return data

        if (operation === 'update' && originalDoc?.event === data.event && originalDoc?.user === data.user) {
          return data
        }

        // A cancelled registration doesn't block re-registering — both rows stay in
        // history (cancel + re-register), which matches append-only event tracking (brief §A2)
        // better than the old hard-delete-and-recreate flow did.
        const existing = await req.payload.find({
          collection: 'registrations',
          where: {
            and: [
              { event: { equals: data.event } },
              { user: { equals: data.user } },
              { status: { not_equals: 'cancelled' } },
            ],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error('This user is already registered for this event.')
        }

        return data
      },
    ],
  },
  timestamps: true,
}
