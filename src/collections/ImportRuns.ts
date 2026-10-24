import type { CollectionConfig } from 'payload'

import { canAccessImportRecords } from './access/import'

const systemOnly = () => false

/**
 * One pass over an event source, or one pasted program or uploaded file read — why it ran, how it
 * went, what it found and changed, and what the AI cost (the calls themselves are in UsageEvents). The
 * history next to a source in the import panel, and what support looks at when a source misbehaves.
 * Written only by the worker (import-events); removed by the nightly data-retention.
 */
export const ImportRuns: CollectionConfig = {
  slug: 'import-runs',
  labels: {
    singular: 'Import Run',
    plural: 'Import Runs',
  },
  admin: {
    useAsTitle: 'trigger',
    defaultColumns: [
      'startedAt',
      'source',
      'trigger',
      'status',
      'found',
      'created',
      'synced',
      'costUsd',
    ],
    description: 'History of event import runs (docs/import-akci-z-webu.md).',
  },
  access: {
    read: canAccessImportRecords,
    create: systemOnly,
    update: systemOnly,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      index: true,
    },
    {
      // Runs of organizers' sources from before import became the obec's alone — a migration
      // removes it.
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      index: true,
      access: { read: systemOnly, create: systemOnly, update: systemOnly },
      admin: { hidden: true },
    },
    { name: 'source', type: 'relationship', relationTo: 'event-sources', index: true },
    {
      name: 'trigger',
      type: 'select',
      required: true,
      options: [
        { label: 'Nightly check', value: 'daily' },
        { label: 'Weekly full pass', value: 'weekly' },
        { label: 'Checked by hand', value: 'manual' },
        { label: 'New source', value: 'new_source' },
        { label: 'Pasted text', value: 'text' },
        { label: 'Uploaded file', value: 'file' },
      ],
    },
    { name: 'requestedBy', type: 'relationship', relationTo: 'users' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'running',
      index: true,
      options: [
        { label: 'Running', value: 'running' },
        { label: 'Done', value: 'success' },
        { label: 'Unchanged', value: 'unchanged' },
        { label: 'Failed', value: 'failed' },
        { label: 'Skipped', value: 'skipped' },
      ],
    },
    { name: 'startedAt', type: 'date', required: true, index: true },
    { name: 'finishedAt', type: 'date' },
    { name: 'format', type: 'text' },
    { name: 'error', type: 'text' },
    { name: 'errorCode', type: 'text' },
    { name: 'found', type: 'number', defaultValue: 0 },
    { name: 'created', type: 'number', defaultValue: 0 },
    {
      name: 'updated',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Pending candidates brought in step with the source.' },
    },
    {
      name: 'synced',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Taken-over events changed after their source.' },
    },
    {
      name: 'needsReview',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Taken-over events the owner has to look at.' },
    },
    { name: 'aiCalls', type: 'number', defaultValue: 0 },
    { name: 'inputTokens', type: 'number', defaultValue: 0 },
    { name: 'outputTokens', type: 'number', defaultValue: 0 },
    {
      name: 'costUsd',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'USD, from usage-events at the price of the day.' },
    },
    { name: 'jobId', type: 'text' },
  ],
  timestamps: true,
}
