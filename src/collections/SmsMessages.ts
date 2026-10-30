import type { CollectionConfig } from 'payload'

/**
 * Every SMS Twilio took — one row per message, against the obec whose event it was about. What the
 * obec's SMS service has used up this month is counted off it (lib/services). Written by the worker
 * once Twilio accepted the message (sms.processor), never through the API; no phone number or text
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
  ],
}
