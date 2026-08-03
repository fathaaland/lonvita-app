import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const Profiles: CollectionConfig = {
  slug: 'profiles',
  labels: {
    singular: 'Profile',
    plural: 'Profiles',
  },
  admin: {
    useAsTitle: 'fullName',
    defaultColumns: ['fullName', 'municipality', 'updatedAt'],
  },
  access: {
    read: isLoggedIn,
    create: isLoggedIn,
    update: ({ req: { user } }) => {
      if (!user) return false
      return { user: { equals: user.id } }
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      return { user: { equals: user.id } }
    },
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      unique: true,
      admin: {
        description: '1:1 link to the account this profile belongs to.',
      },
    },
    {
      name: 'fullName',
      type: 'text',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      admin: {
        description: "The user's home municipality.",
      },
    },
    {
      name: 'payoutIban',
      type: 'text',
      label: 'Payout IBAN',
      admin: {
        description: 'Organizer payout account. Only visible/editable by the profile owner.',
      },
      access: {
        read: ({ req: { user }, doc }) => Boolean(user && doc?.user === user.id),
        update: ({ req: { user }, doc }) => Boolean(user && doc?.user === user.id),
      },
    },
    {
      name: 'phone',
      type: 'text',
    },
    {
      name: 'dateOfBirth',
      type: 'date',
    },
    {
      name: 'gender',
      type: 'select',
      options: [
        { label: 'Žena', value: 'zena' },
        { label: 'Muž', value: 'muz' },
        { label: 'Jiné', value: 'jine' },
        { label: 'Neuvedeno', value: 'neuvedeno' },
      ],
    },
    {
      name: 'interests',
      type: 'relationship',
      relationTo: 'event-categories',
      hasMany: true,
    },
    {
      name: 'homeArea',
      type: 'relationship',
      relationTo: 'municipality-areas',
      admin: {
        description: 'Neighborhood within the municipality, chosen during onboarding.',
      },
    },
    {
      name: 'onboardingCompleted',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'isVolunteer',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'volunteerFocus',
      type: 'text',
      hasMany: true,
    },
    {
      name: 'volunteerNote',
      type: 'textarea',
    },
    {
      name: 'volunteerSince',
      type: 'date',
    },
  ],
  timestamps: true,
}
