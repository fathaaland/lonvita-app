import type { Access, CollectionConfig } from 'payload'

/** Linked sign-ins are plumbing, not something a person manages: only the Google callback
 * (Local API, `overrideAccess`) creates or reads them, and only a platform admin sees them over the API. */
const adminOnly: Access = ({ req }) => req.user?.role === 'admin'

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
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
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
        description: "The provider's stable subject id — Google's OIDC `sub` claim.",
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
      name: 'avatarImportedAt',
      type: 'date',
      admin: {
        description:
          "When the provider's profile photo was offered to the profile. Set once — a person who removes the photo afterwards doesn't get it back on the next sign-in.",
      },
    },
    {
      name: 'profile',
      type: 'json',
      admin: {
        description: "Raw profile payload from the provider, cached for reference.",
      },
    },
  ],
  timestamps: true,
}
