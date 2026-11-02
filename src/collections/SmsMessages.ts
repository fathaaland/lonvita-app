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
    defaultColumns: ['createdAt', 'municipality', 'requestId'],
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
    { name: 'requestId', type: 'text' },
    { name: 'providerMessageSid', type: 'text' },
    // How many SMS parts (160 characters each) it went out as — what the obec's quota counts.
    { name: 'parts', type: 'number', defaultValue: 1, min: 1 },
    // Past the yearly quota, sent because the obec allows overage — billed at the year's end.
    { name: 'overage', type: 'checkbox', defaultValue: false },
  ],
}
