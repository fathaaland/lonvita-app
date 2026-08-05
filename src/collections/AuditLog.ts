import type { CollectionConfig } from 'payload'

export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  labels: {
    singular: 'Audit Log Entry',
    plural: 'Audit Log',
  },
  admin: {
    useAsTitle: 'action',
    defaultColumns: ['action', 'actor', 'targetCollection', 'targetId', 'createdAt'],
    description:
      'Append-only. Written by server-side hooks (overrideAccess) on sensitive changes — role grants, consent revocation. Not writable or deletable through the API.',
  },
  access: {
    // Written exclusively via `overrideAccess: true` from collection hooks — never
    // reachable through the public API, so this stays a true system-only log.
    create: () => false,
    read: ({ req: { user } }) => user?.role === 'admin',
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'action',
      type: 'text',
      required: true,
      admin: {
        description: 'e.g. "user-roles.grant", "consents.revoke".',
      },
    },
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Who performed the action. Empty for system-triggered entries.',
      },
    },
    {
      name: 'targetCollection',
      type: 'text',
      required: true,
    },
    {
      name: 'targetId',
      type: 'text',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
    },
    {
      name: 'metadata',
      type: 'json',
    },
  ],
  timestamps: true,
}
