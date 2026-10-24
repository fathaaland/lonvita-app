import type { CollectionConfig } from 'payload'

export const SECURITY_EVENT_OUTCOMES = ['success', 'failure'] as const

/**
 * Who signed in, failed to, signed out, reset a password or hit a rate limit — and from where.
 * Written straight to the table by the logger (lib/logger/db-sink) for every `auth.*`/`security.*`
 * line and every logger.audit call; never through the API. Kept 12 months
 * (lib/retention/policy.ts) and copied each night, with the audit log, to the write-once audit
 * bucket (worker export-audit-trail).
 */
export const SecurityEvents: CollectionConfig = {
  slug: 'security-events',
  labels: { singular: 'Security Event', plural: 'Security Events' },
  admin: {
    useAsTitle: 'event',
    defaultColumns: ['createdAt', 'event', 'outcome', 'userEmail', 'ip'],
    listSearchableFields: ['event', 'userEmail', 'ip', 'correlationId'],
    description:
      'Sign-ins (failed ones too), sign-outs, password resets and rate limits. Kept 12 months; copied nightly to the write-once audit bucket.',
  },
  defaultSort: '-createdAt',
  access: {
    read: ({ req: { user } }) => user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'event', type: 'text', required: true, index: true },
    {
      name: 'outcome',
      type: 'select',
      required: true,
      index: true,
      options: SECURITY_EVENT_OUTCOMES.map((value) => ({ label: value, value })),
    },
    { name: 'message', type: 'text', required: true },
    { name: 'userId', type: 'number', index: true },
    { name: 'userEmail', type: 'text', index: true },
    { name: 'ip', type: 'text', index: true },
    { name: 'userAgent', type: 'text' },
    { name: 'service', type: 'text' },
    { name: 'correlationId', type: 'text', index: true },
    { name: 'context', type: 'json', admin: { description: 'Every other field of the line.' } },
  ],
}
