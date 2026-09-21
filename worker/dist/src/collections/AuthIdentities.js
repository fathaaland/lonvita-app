export const AuthIdentities = {
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
            name: 'profile',
            type: 'json',
            admin: {
                description: "Raw profile payload from the provider, cached for reference.",
            },
        },
    ],
    timestamps: true,
};
