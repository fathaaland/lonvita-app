import type { CollectionConfig } from 'payload'

import { isPlatformOrMunicipalityAdmin } from './access/shared'

const systemOnly = () => false

/**
 * An event found on an obec's web (EventSources), in a pasted program or an uploaded file, waiting
 * for the obec's admin. Nothing reaches the obec's events without them: approving creates the event
 * through the collection's own checks, as the admin (lib/import/approve), rejecting sets it aside.
 * Written only by the worker and those two routes; `externalKey` keeps the same event from coming
 * back on every pass over its source — whatever was decided about it.
 */
export const EventImportCandidates: CollectionConfig = {
  slug: 'event-import-candidates',
  labels: {
    singular: 'Event Import Candidate',
    plural: 'Event Import Candidates',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'startsAt', 'municipality', 'status', 'createdAt'],
    description:
      'Imported events waiting for the obec admin (docs/import-akci-z-webu.md). Written by the worker, decided via /api/import/candidates.',
  },
  access: {
    read: isPlatformOrMunicipalityAdmin(),
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
    { name: 'source', type: 'relationship', relationTo: 'event-sources', index: true },
    {
      name: 'origin',
      type: 'select',
      required: true,
      options: [
        { label: 'Source (web)', value: 'source' },
        { label: 'Pasted text', value: 'text' },
        { label: 'Uploaded file', value: 'file' },
      ],
    },
    {
      name: 'originLabel',
      type: 'text',
      admin: { description: 'The source address or the uploaded file name.' },
    },
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Who pasted the text or uploaded the file.' },
    },
    { name: 'externalKey', type: 'text', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
    },
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'startsAt', type: 'date', required: true, index: true },
    {
      name: 'timeKnown',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'The source states the start time.' },
    },
    { name: 'endsAt', type: 'date' },
    { name: 'locationText', type: 'text' },
    { name: 'lat', type: 'number' },
    { name: 'lng', type: 'number' },
    {
      name: 'detailUrl',
      type: 'text',
      admin: { description: "The event's own page on the source." },
    },
    { name: 'categories', type: 'relationship', relationTo: 'event-categories', hasMany: true },
    { name: 'isPaid', type: 'checkbox' },
    { name: 'priceCzk', type: 'number', min: 0 },
    {
      // lib/import/contracts IMPORT_WARNINGS — what keeps it from being approved without opening it.
      name: 'warnings',
      type: 'json',
    },
    {
      name: 'duplicateOf',
      type: 'relationship',
      relationTo: 'events',
      admin: { description: 'A similar event already in Lonvita.' },
    },
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      admin: { description: 'The event created on approval.' },
    },
    {
      name: 'decidedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
    },
    { name: 'decidedAt', type: 'date', admin: { position: 'sidebar' } },
  ],
  timestamps: true,
}
