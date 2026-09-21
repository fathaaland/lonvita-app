import { isLoggedIn } from './access/shared';
import { deletedAtField, adminOnlyDelete } from './shared/softDelete';
export const EventMedia = {
    slug: 'event-media',
    labels: {
        singular: 'Event Photo',
        plural: 'Event Photos',
    },
    admin: {
        useAsTitle: 'id',
        defaultColumns: ['event', 'visibility', 'uploadedBy', 'updatedAt'],
    },
    access: {
        read: ({ req: { user } }) => {
            if (!user) {
                return { and: [{ deletedAt: { exists: false } }, { visibility: { equals: 'public' } }] };
            }
            return {
                and: [
                    { deletedAt: { exists: false } },
                    {
                        or: [
                            { visibility: { equals: 'public' } },
                            { visibility: { equals: 'municipality' } },
                            { uploadedBy: { equals: user.id } },
                        ],
                    },
                ],
            };
        },
        create: isLoggedIn,
        update: ({ req: { user } }) => {
            if (!user)
                return false;
            return { uploadedBy: { equals: user.id } };
        },
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
            name: 'media',
            type: 'relationship',
            relationTo: 'media',
            required: true,
        },
        {
            name: 'uploadedBy',
            type: 'relationship',
            relationTo: 'users',
            required: true,
        },
        {
            name: 'visibility',
            type: 'select',
            required: true,
            defaultValue: 'municipality',
            options: [
                { label: 'Private', value: 'private' },
                { label: 'Municipality', value: 'municipality' },
                { label: 'Public', value: 'public' },
            ],
        },
        deletedAtField,
    ],
    timestamps: true,
};
