import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const OrganizerPayouts: CollectionConfig = {
  slug: 'organizer-payouts',
  labels: {
    singular: 'Organizer Payout',
    plural: 'Organizer Payouts',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['profile', 'amountCents', 'status', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => Boolean(user),
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
  },
  fields: [
    {
      name: 'profile',
      type: 'relationship',
      relationTo: 'profiles',
      required: true,
    },
    {
      name: 'amountCents',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      name: 'currency',
      type: 'text',
      defaultValue: 'CZK',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Processing', value: 'processing' },
        { label: 'Paid', value: 'paid' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'stripeTransferId',
      type: 'text',
      admin: {
        description: 'Stripe transfer ID once the payout has been sent.',
      },
    },
    {
      name: 'periodStart',
      type: 'date',
    },
    {
      name: 'periodEnd',
      type: 'date',
    },
  ],
  timestamps: true,
}
