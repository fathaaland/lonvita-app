import type { CollectionConfig } from 'payload'

import { canAccessImportRecords } from './access/import'

const systemOnly = () => false

/**
 * An event found on a web calendar (EventSources), in a pasted program or an uploaded file, waiting
 * for the obec's admins (access/import). Nothing
 * reaches the events without them: approving creates the event through the collection's own checks,
 * as them (lib/import/approve), rejecting sets it aside. Once taken over it stays as the link
 * between the event and its source: each pass brings the event's date, time and place in step with
 * the source where nobody changed them in Lonvita, and notes for the owner what it didn't
 * (lib/import/sync). Written only by the worker and the /api/import routes; `externalKey` keeps the
 * same event from coming back on every pass over its source — whatever was decided about it.
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
      'Imported events waiting for their owner, and the link of taken-over ones to their source (docs/import-akci-z-webu.md). Written by the worker, decided via /api/import/candidates.',
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
      // Organizers' candidates from before import became the obec's alone — nothing sets it any
      // more, and a migration removes it.
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      index: true,
      access: { read: systemOnly, create: systemOnly, update: systemOnly },
      admin: { hidden: true },
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
      // What the event is known by on its source whatever its date — the iCal UID, its own page —
      // so an event moved to another day is still the same one (lib/import/normalize sourceRefOf).
      name: 'sourceRef',
      type: 'text',
      index: true,
    },
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
    // As the source last said — for a taken-over event, what the next pass compares the source with.
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
    // --- Keeping a taken-over event in step with its source (lib/import/sync) ----------------
    {
      // lib/import/contracts SyncNotice[] — what the owner should look at.
      name: 'syncNotices',
      type: 'json',
    },
    {
      // Whether `syncNotices` holds anything — what the import panel lists them by.
      name: 'syncNeedsReview',
      type: 'checkbox',
      defaultValue: false,
      index: true,
    },
    { name: 'noticedAt', type: 'date' },
    { name: 'lastSyncedAt', type: 'date', admin: { position: 'sidebar' } },
    {
      // The last pass whose source still listed it.
      name: 'lastSeenAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
    {
      // Passes in a row it was missing from a source that still lists events around its date.
      name: 'missingCount',
      type: 'number',
      defaultValue: 0,
      admin: { position: 'sidebar' },
    },
  ],
  timestamps: true,
}
