import type { CollectionConfig } from 'payload'

export const SYSTEM_LOG_LEVELS = ['info', 'warn', 'error', 'fatal'] as const

/**
 * What the app and the worker had to say — every warning and error, and the info lines that name an
 * event (an e-mail sent, an import finished, a job done). Written straight to the table by the
 * logger (lib/logger/db-sink), never through the API. Kept 90 days (lib/retention/policy.ts).
 * Changes to data are in the audit log, sign-ins in security events, AI spend in usage events.
 */
export const SystemLogs: CollectionConfig = {
  slug: 'system-logs',
  labels: { singular: 'System Log', plural: 'System Logs' },
  admin: {
    useAsTitle: 'event',
    defaultColumns: ['createdAt', 'level', 'event', 'message', 'service', 'municipalityId'],
    listSearchableFields: ['event', 'message', 'correlationId'],
    description:
      'Warnings, errors and notable events of the app and the worker. Kept 90 days. The correlation id joins every line of one request or job.',
  },
  defaultSort: '-createdAt',
  access: {
    read: ({ req: { user } }) => user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'level',
      type: 'select',
      required: true,
      index: true,
      options: SYSTEM_LOG_LEVELS.map((value) => ({ label: value, value })),
    },
    { name: 'event', type: 'text', index: true },
    { name: 'message', type: 'text', required: true },
    { name: 'service', type: 'text', required: true, index: true },
    { name: 'environment', type: 'text' },
    { name: 'correlationId', type: 'text', index: true },
    // Plain numbers, not relationships: a log line outlives the user or obec it mentions.
    { name: 'userId', type: 'number', index: true },
    { name: 'municipalityId', type: 'number', index: true },
    { name: 'errorName', type: 'text' },
    { name: 'errorMessage', type: 'text' },
    { name: 'errorStack', type: 'textarea' },
    { name: 'context', type: 'json', admin: { description: 'Every other field of the line.' } },
  ],
}
