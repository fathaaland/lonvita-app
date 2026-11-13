import type { CollectionConfig } from 'payload'

import { writeAuditLog } from './shared/auditLog'

const ownedByUser = ({ req: { user } }: { req: { user: { id: number; role?: string } | null } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  return { user: { equals: user.id } }
}

const immutableAfterCreate = { update: () => false }

export const Consents: CollectionConfig = {
  slug: 'consents',
  labels: {
    singular: 'Consent',
    plural: 'Consents',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'type', 'version', 'grantedAt', 'revokedAt'],
    description:
      'Append-only consent log — GDPR foundation (brief A3). Existing rows are never edited except revokedAt; a changed policy version is a new row, not an update.',
  },
  access: {
    read: ownedByUser,
    create: ({ req: { user }, data }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return data?.user === user.id
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
        // A declaration, not a consent: the account holder says they are 15 or older — the age
        // § 7 of zákon 110/2019 Sb. sets for accepting an information-society service on one's own.
        // Nothing checks it further; the row records who declared it, when and to which text.
        { label: 'Prohlášení: věk 15+', value: 'age_15_plus' },
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
        if (operation !== 'update' || previousDoc?.revokedAt || !doc.revokedAt) return
        writeAuditLog(req.payload, {
          source: req,
          action: 'consents.revoke',
          actor: req.user?.id ?? null,
          targetCollection: 'consents',
          targetId: doc.id,
          metadata: { user: typeof doc.user === 'object' ? doc.user.id : doc.user, type: doc.type },
        })
      },
    ],
  },
  timestamps: true,
}
