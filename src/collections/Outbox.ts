import type { CollectionConfig } from 'payload'

/**
 * The transactional outbox (lib/outbox): a queue job that has to reach Redis — the announcement of
 * a cancelled or changed event above all. Written in the same transaction as the change it announces,
 * so the two commit or roll back together; handed to the queue once committed and marked
 * `dispatchedAt`. What is still not dispatched a minute later (Redis down, the function frozen
 * between the commit and the add) the worker's outbox relay hands over again, under the same job id.
 * Never through the API: written and read by the app's own code only. Dispatched rows go after a week.
 */
export const Outbox: CollectionConfig = {
  slug: 'outbox',
  labels: { singular: 'Outbox Job', plural: 'Outbox' },
  admin: {
    useAsTitle: 'jobId',
    defaultColumns: ['createdAt', 'jobType', 'jobId', 'dispatchedAt', 'attempts'],
  },
  defaultSort: '-createdAt',
  access: {
    read: ({ req: { user } }) => user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    // The envelope's jobType (which also says its queue) — what the admin list shows.
    { name: 'jobType', type: 'text', required: true },
    // BullMQ dedupes on it: a relay of a job that did reach the queue adds nothing.
    { name: 'jobId', type: 'text', required: true },
    // The whole QueueJobEnvelope, correlationId included.
    { name: 'job', type: 'json', required: true },
    // When the job may run (the `delay` it was enqueued with, as a point in time — a relay much
    // later must not push it further out).
    { name: 'runAt', type: 'date' },
    // Empty until the job is in the queue — what the relay looks for.
    { name: 'dispatchedAt', type: 'date', index: true },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    { name: 'lastError', type: 'text' },
  ],
}
