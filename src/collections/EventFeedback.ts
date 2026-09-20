import type { Access, CollectionConfig, Where } from 'payload'

import { canReadOwnOrAdministered } from './access/shared'
import { deletedAtField, adminOnlyDelete, notDeleted } from './shared/softDelete'

/** Only the participant who owns the underlying registration may create their own feedback. */
const canCreateOwnFeedback: Access = async ({ req: { user, payload }, data }) => {
  if (!user) return false
  if (!data?.registration) return false
  const registration = await payload.findByID({
    collection: 'registrations',
    id: data.registration,
    depth: 0,
    overrideAccess: true,
  })
  const ownerId = typeof registration?.user === 'object' ? registration.user.id : registration?.user
  return String(ownerId) === String(user.id)
}

/** Only the feedback's own author may edit it later. */
const ownFeedback: Access = ({ req: { user } }) => {
  if (!user) return false
  return { 'registration.user': { equals: user.id } }
}

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
    // Own feedback, or an admin of the event's municipality (aggregate ratings on admin-obce).
    read: async (ctx) => {
      const inner = await canReadOwnOrAdministered('registration.user', 'registration.event.municipality')(ctx)
      if (inner === false) return false
      if (inner === true) return notDeleted
      return { and: [notDeleted, inner as Where] }
    },
    create: canCreateOwnFeedback,
    update: ownFeedback,
    delete: adminOnlyDelete,
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
    deletedAtField,
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
