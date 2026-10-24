import type {
  CollectionAfterChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'
import { APIError } from 'payload'

import { canAccessImportRecords } from './access/import'
import { canCreateForAdministeredMunicipality } from './access/shared'
import { auditDeletion, writeAuditLog } from './shared/auditLog'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { ImportFetchError, normalizeSourceUrl } from '@/lib/import/fetch'
import { enqueueImportEvents } from '@/lib/queue/queues'
import { logger, serializeError } from '@/lib/logger'
import { relationId } from '@/lib/relations'

const SOURCE_URL_MAX_LENGTH = 2000

/** The client names the obec, the address, a label, and confirms the web is theirs or they may take
 * events from it — the rest is the system's. The address must be a public web address (fetch
 * normalizeSourceUrl), once per obec, and an obec keeps at most IMPORT_LIMITS.sourcesPerMunicipality
 * of them. */
const prepareSource: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data
  const raw = typeof data.url === 'string' ? data.url : ''
  if (!raw.trim() || raw.length > SOURCE_URL_MAX_LENGTH)
    throw new APIError('Zadejte adresu stránky s akcemi.', 400)
  let url: string
  try {
    url = normalizeSourceUrl(raw).toString()
  } catch (error) {
    throw new APIError(error instanceof ImportFetchError ? error.message : 'Neplatná adresa.', 400)
  }
  // Trusted internal writes (no user — seeds, tests) aren't anyone's word.
  if (req.user && data.ownerConsent !== true) {
    throw new APIError(
      'Potvrďte, že web provozujete, nebo že vám jeho provozovatel převzetí akcí dovolil.',
      400,
    )
  }

  const municipalityId = relationId(data.municipality)
  if (!municipalityId) throw new APIError('Chybí obec.', 400)

  const existing = await req.payload.find({
    collection: 'event-sources',
    where: {
      and: [{ municipality: { equals: municipalityId } }, { organization: { exists: false } }],
    },
    select: { url: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (existing.docs.some((s) => s.url === url)) throw new APIError('Tenhle zdroj už máte.', 400)
  const limit = IMPORT_LIMITS.sourcesPerMunicipality
  if (existing.docs.length >= limit) {
    throw new APIError(`Obec může mít nejvýš ${limit} zdrojů akcí.`, 400)
  }

  const label = typeof data.label === 'string' ? data.label.trim().slice(0, 120) : ''
  return {
    municipality: Number(municipalityId),
    url,
    label: label || new URL(url).hostname.replace(/^www\./, ''),
    enabled: data.enabled !== false,
    createdBy: req.user?.id ?? null,
    ownerConsentAt: req.user ? new Date().toISOString() : null,
  }
}

/** A new source is read straight away — the owner sees what it brings without waiting for the next
 * night; so is one switched back on. Never blocks saving it. */
const readNewSource: CollectionAfterChangeHook = async ({ doc, operation, previousDoc, req }) => {
  const switchedOn = operation === 'update' && doc.enabled && !previousDoc?.enabled
  if (operation === 'create') {
    writeAuditLog(req.payload, {
      source: req,
      action: 'event-sources.create',
      actor: req.user?.id ?? null,
      targetCollection: 'event-sources',
      targetId: doc.id,
      municipality: Number(relationId(doc.municipality)),
      // The owner's word that they may take events from the web — kept with who gave it.
      metadata: { url: doc.url, ownerConsent: Boolean(doc.ownerConsentAt) },
    })
  }
  if ((operation === 'create' && doc.enabled) || switchedOn) {
    // A moment's delay: this still runs inside the request's transaction.
    await enqueueImportEvents(
      {
        kind: 'source',
        sourceId: doc.id,
        trigger: operation === 'create' ? 'new_source' : 'daily',
        requestedBy: req.user?.id ?? null,
      },
      { delay: 3_000 },
    ).catch((error) =>
      logger.warn('New import source not queued', {
        event: 'import.source_enqueue_failed',
        sourceId: doc.id,
        ...serializeError(error),
      }),
    )
  }
  return doc
}

const systemField = { create: () => false, update: () => false }
/** Organizers' sources from before import became the obec's alone — nothing sets it any more, and a
 * migration removes it. */
const retiredField = { ...systemField, read: () => false }
const hiddenSystemField = {
  read: ({ req }: { req: { user?: { role?: string } | null } }) => req.user?.role === 'admin',
  create: () => false,
  update: () => false,
}

/**
 * A page events are read from — the obec's own web calendar, the cultural centre's program, a public
 * Google Calendar — kept by an obec, looked after by its admins (access/import). The
 * worker checks every enabled one each night and reads it through once a week (and right after it's
 * added); what it finds waits for the owner in EventImportCandidates, and events already taken over
 * from it are kept in step with it (lib/import/sync).
 */
export const EventSources: CollectionConfig = {
  slug: 'event-sources',
  labels: {
    singular: 'Event Source',
    plural: 'Event Sources',
  },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'municipality', 'enabled', 'lastRunAt', 'lastError'],
    description:
      "Web pages and calendars an obec's events are imported from (docs/import-akci-z-webu.md).",
  },
  access: {
    read: canAccessImportRecords,
    create: canCreateForAdministeredMunicipality(),
    update: canAccessImportRecords,
    delete: canAccessImportRecords,
  },
  fields: [
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      index: true,
      access: { update: () => false },
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      index: true,
      access: retiredField,
      admin: { hidden: true },
    },
    // Fixed once added — a different address is a different source.
    {
      name: 'url',
      type: 'text',
      required: true,
      maxLength: SOURCE_URL_MAX_LENGTH,
      access: { update: () => false },
    },
    { name: 'label', type: 'text', maxLength: 120 },
    { name: 'enabled', type: 'checkbox', defaultValue: true },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      access: systemField,
      admin: { position: 'sidebar' },
    },
    {
      // When whoever added it confirmed the web is theirs, or that its operator lets them take
      // events from it (the request's `ownerConsent: true`).
      name: 'ownerConsentAt',
      type: 'date',
      access: systemField,
      admin: { position: 'sidebar' },
    },
    {
      // What the last successful read found the address to be.
      name: 'format',
      type: 'select',
      access: systemField,
      options: [
        { label: 'iCal', value: 'ical' },
        { label: 'schema.org', value: 'jsonld' },
        { label: 'HTML (AI)', value: 'html' },
        { label: 'RSS/Atom (AI)', value: 'feed' },
        { label: 'PDF (AI)', value: 'pdf' },
        { label: 'Image (AI)', value: 'image' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'lastRunAt', type: 'date', access: systemField, admin: { position: 'sidebar' } },
    { name: 'lastSuccessAt', type: 'date', access: systemField, admin: { position: 'sidebar' } },
    { name: 'lastError', type: 'text', access: systemField, admin: { position: 'sidebar' } },
    { name: 'lastFoundCount', type: 'number', access: systemField, admin: { position: 'sidebar' } },
    {
      name: 'consecutiveFailures',
      type: 'number',
      defaultValue: 0,
      access: systemField,
      admin: { position: 'sidebar' },
    },
    {
      // A fingerprint of the dated lines last read — a page changed elsewhere isn't sent to the AI again.
      name: 'lastContentHash',
      type: 'text',
      access: hiddenSystemField,
      admin: { hidden: true },
    },
    {
      // What the server said identifies the version last read (ETag, Last-Modified) — asked back,
      // an unchanged page isn't even downloaded (lib/import/pipeline readUrl).
      name: 'etag',
      type: 'text',
      access: hiddenSystemField,
      admin: { hidden: true },
    },
    { name: 'lastModified', type: 'text', access: hiddenSystemField, admin: { hidden: true } },
  ],
  hooks: {
    beforeValidate: [prepareSource],
    afterChange: [readNewSource],
    afterDelete: [
      auditDeletion<{ url?: string; municipality?: number | { id: number } | null }>((doc) => ({
        municipality: Number(relationId(doc.municipality)) || null,
        metadata: { url: doc.url },
      })),
    ],
  },
  timestamps: true,
}
