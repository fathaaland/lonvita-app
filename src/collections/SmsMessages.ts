import type { CollectionConfig } from 'payload'

/**
 * Every SMS BulkGate took — one row per message, against the obec whose event it was about. What the
 * obec's SMS quota has used up this licence year is counted off it (lib/services), part by part. Written by the worker
 * once BulkGate accepted the message (sms.processor), never through the API; no phone number or text
 * kept — the count is what matters.
 */
export const SmsMessages: CollectionConfig = {
  slug: 'sms-messages',
  labels: { singular: 'SMS Message', plural: 'SMS Messages' },
  admin: {
    useAsTitle: 'requestId',
    defaultColumns: ['createdAt', 'municipality', 'organization', 'requestId'],
  },
  defaultSort: '-createdAt',
  access: {
    read: ({ req: { user } }) => user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      // Empty once the obec is deleted; the row stays.
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      index: true,
    },
    {
      // Whose event the SMS was about — the obec's own organization or one of its organizers'. What
      // the obec's overview of who used its SMS package groups by. Empty on SMS from before it was
      // kept, and once the organization is gone; the row stays.
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      index: true,
    },
    { name: 'requestId', type: 'text' },
    { name: 'providerMessageSid', type: 'text' },
    // How many SMS parts (160 characters each) it went out as — what the obec's quota counts.
    { name: 'parts', type: 'number', defaultValue: 1, min: 1 },
    // Past the yearly quota, sent because the obec allows overage — billed at the year's end.
    { name: 'overage', type: 'checkbox', defaultValue: false },
  ],
}
