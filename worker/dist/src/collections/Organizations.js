import { isLoggedIn } from './access/shared';
import { deletedAtField, notDeleted } from './shared/softDelete';
/** Only the organizer who owns this organization entry (or a platform admin) may change it —
 * brief §4 "Organizace" names are free text the organizer manages themselves, no obec approval. */
const isOwnerOrPlatformAdmin = ({ req: { user } }) => {
    if (!user)
        return false;
    if (user.role === 'admin')
        return true;
    return { owner: { equals: user.id } };
};
export const Organizations = {
    slug: 'organizations',
    labels: {
        singular: 'Organization',
        plural: 'Organizations',
    },
    admin: {
        useAsTitle: 'name',
        defaultColumns: ['name', 'owner', 'updatedAt'],
    },
    access: {
        // Shown on public event cards/detail (brief §4 "pod kterou organizací ji publikuje").
        read: () => notDeleted,
        create: isLoggedIn,
        update: isOwnerOrPlatformAdmin,
        delete: isOwnerOrPlatformAdmin,
    },
    fields: [
        {
            name: 'name',
            type: 'text',
            required: true,
            admin: {
                description: 'Free text, no obec approval needed — the organizer manages their own list in their profile.',
            },
        },
        {
            name: 'owner',
            type: 'relationship',
            relationTo: 'users',
            required: true,
            admin: {
                description: 'The organizer who added this organization.',
                position: 'sidebar',
            },
        },
        deletedAtField,
    ],
    timestamps: true,
};
