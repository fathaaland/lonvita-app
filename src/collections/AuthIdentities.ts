import type { Access, CollectionConfig } from 'payload'

/** A person sees and can remove their own linked sign-ins (the profile's "Propojené účty");
 * creating one only ever happens through the Google callback, which vouches for the account. */
const adminOrOwn: Access = ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  return { user: { equals: req.user.id } }
}

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
    read: adminOrOwn,
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: adminOrOwn,
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
