import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const EventFeedback: CollectionConfig = {
  slug: 'event-feedback',
  labels: {
    singular: 'Event Feedback',
    plural: 'Event Feedback',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['registration', 'satisfactionRating', 'updatedAt'],
  },
  access: {
    read: isLoggedIn,
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
  },
  fields: [
    {
      name: 'registration',
      type: 'relationship',
      relationTo: 'registrations',
      required: true,
      unique: true,
      admin: {
        description: 'One feedback entry per attended registration.',
      },
    },
    {
      name: 'satisfactionRating',
      type: 'number',
      required: true,
      min: 1,
      max: 5,
    },
    {
      name: 'feltWelcomeRating',
      type: 'number',
      min: 1,
      max: 5,
      admin: {
        description: 'Did you feel welcome?',
      },
    },
    {
      name: 'metSomeoneNew',
      type: 'checkbox',
      admin: {
        description: 'Did you meet someone new?',
      },
    },
    {
      name: 'cameAlone',
      type: 'checkbox',
      admin: {
        description: 'Did you come alone?',
      },
    },
    {
      name: 'comment',
      type: 'textarea',
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation }) => {
        if (operation !== 'create' || !data?.registration) return data

        const registration = await req.payload.findByID({
          collection: 'registrations',
          id: data.registration,
        })

        if (registration?.attendanceStatus !== 'attended') {
          throw new Error('Feedback can only be submitted for a registration marked as attended.')
        }

        return data
      },
    ],
  },
  timestamps: true,
}
