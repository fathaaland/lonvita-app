import type { CollectionConfig } from 'payload'

export const AuthIdentities: CollectionConfig = {
  slug: 'auth-identities',
  labels: {
    singular: 'Auth Identity',
    plural: 'Auth Identities',
  },
  admin: {
    useAsTitle: 'providerSubject',
  },
  access: {
    read: ({ req }) => req.user?.role === 'admin',
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    {
      name: 'providerSubject',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'The Auth0 "sub" claim, e.g. auth0|abc123 or google-oauth2|123.',
      },
    },
    {
      name: 'provider',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'connection',
      type: 'text',
      index: true,
    },
    {
      name: 'providerType',
      type: 'text',
      admin: {
        description: 'database | social',
      },
    },
    {
      name: 'email',
      type: 'text',
      index: true,
    },
    {
      name: 'emailVerified',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'lastLoginAt',
      type: 'date',
    },
    {
      name: 'lastSyncedAt',
      type: 'date',
    },
    {
      name: 'profile',
      type: 'json',
      admin: {
        description: 'Raw Auth0 session.user payload, cached for reference.',
      },
    },
  ],
  timestamps: true,
}
