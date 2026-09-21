import { writeAuditLog } from './shared/auditLog';
const ownedByUser = ({ req: { user } }) => {
    if (!user)
        return false;
    if (user.role === 'admin')
        return true;
    return { user: { equals: user.id } };
};
const immutableAfterCreate = { update: () => false };
export const Consents = {
    slug: 'consents',
    labels: {
        singular: 'Consent',
        plural: 'Consents',
    },
    admin: {
        useAsTitle: 'id',
        defaultColumns: ['user', 'type', 'version', 'grantedAt', 'revokedAt'],
        description: 'Append-only consent log — GDPR foundation (brief A3). Existing rows are never edited except revokedAt; a changed policy version is a new row, not an update.',
    },
    access: {
        read: ownedByUser,
        create: ({ req: { user }, data }) => {
            if (!user)
                return false;
            if (user.role === 'admin')
                return true;
            return data?.user === user.id;
        },
        update: ownedByUser,
        delete: ({ req: { user } }) => user?.role === 'admin',
    },
    fields: [
        {
            name: 'user',
            type: 'relationship',
            relationTo: 'users',
            required: true,
            access: immutableAfterCreate,
        },
        {
            name: 'type',
            type: 'select',
            required: true,
            options: [
                { label: 'Podmínky platformy', value: 'platform_terms' },
                { label: 'Marketingová komunikace', value: 'marketing' },
            ],
            admin: {
                description: 'Schema allows more types later (wellbeing_measurement, media_publication…) without a migration — see ERD §2.4.',
            },
            access: immutableAfterCreate,
        },
        {
            name: 'version',
            type: 'text',
            required: true,
            admin: {
                description: 'Version of the consent text the user agreed to, e.g. "1.0".',
            },
            access: immutableAfterCreate,
        },
        {
            name: 'grantedAt',
            type: 'date',
            required: true,
            access: immutableAfterCreate,
        },
        {
            name: 'revokedAt',
            type: 'date',
            admin: {
                description: 'Revoking does not delete the row or any participation history it relates to.',
            },
        },
    ],
    hooks: {
        afterChange: [
            ({ doc, previousDoc, req, operation }) => {
                if (operation !== 'update' || previousDoc?.revokedAt || !doc.revokedAt)
                    return;
                writeAuditLog(req.payload, {
                    action: 'consents.revoke',
                    actor: req.user?.id ?? null,
                    targetCollection: 'consents',
                    targetId: doc.id,
                    metadata: { user: doc.user, type: doc.type },
                });
            },
        ],
    },
    timestamps: true,
};
