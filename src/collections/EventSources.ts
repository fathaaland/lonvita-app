import type {
  CollectionAfterChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'
import { APIError } from 'payload'

import {
  canCreateForAdministeredMunicipality,
  isPlatformOrMunicipalityAdmin,
} from './access/shared'
import { auditDeletion, writeAuditLog } from './shared/auditLog'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { ImportFetchError, normalizeSourceUrl } from '@/lib/import/fetch'
import { enqueueImportEvents } from '@/lib/queue/queues'
import { logger, serializeError } from '@/lib/logger'
import { relationId } from '@/lib/relations'

const SOURCE_URL_MAX_LENGTH = 2000

/** The client names the obec, the address and a label — the rest is the system's. The address must
 * be a public web address (fetch normalizeSourceUrl), once per obec, and an obec keeps at most
 * IMPORT_LIMITS.sourcesPerMunicipality of them. */
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

  const municipalityId = relationId(data.municipality)
  if (!municipalityId) throw new APIError('Chybí obec.', 400)
  const existing = await req.payload.find({
    collection: 'event-sources',
    where: { municipality: { equals: municipalityId } },
    select: { url: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (existing.docs.some((s) => s.url === url)) throw new APIError('Tenhle zdroj už obec má.', 400)
  if (existing.docs.length >= IMPORT_LIMITS.sourcesPerMunicipality) {
    throw new APIError(
      `Obec může mít nejvýš ${IMPORT_LIMITS.sourcesPerMunicipality} zdrojů akcí.`,
      400,
    )
  }

  const label = typeof data.label === 'string' ? data.label.trim().slice(0, 120) : ''
  return {
    municipality: Number(municipalityId),
    url,
    label: label || new URL(url).hostname.replace(/^www\./, ''),
    enabled: data.enabled !== false,
    createdBy: req.user?.id ?? null,
  }
}

/** A new source is read straight away — the admin sees what it brings without waiting for the next
 * scheduled pass; so is one switched back on. Never blocks saving it. */
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
      metadata: { url: doc.url },
    })
  }
  if ((operation === 'create' && doc.enabled) || switchedOn) {
    // A moment's delay: this still runs inside the request's transaction.
    await enqueueImportEvents({ kind: 'source', sourceId: doc.id }, { delay: 3_000 }).catch(
      (error) =>
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

/**
 * A page an obec's events are read from — its own web's calendar, the cultural centre's program, a
 * public Google Calendar. The worker goes through every enabled one every few hours (and right after
 * it's added); what it finds waits for the obec's admin in EventImportCandidates. The obec's admins
 * keep their own sources; a platform admin sees all of them.
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
    read: isPlatformOrMunicipalityAdmin(),
    create: canCreateForAdministeredMunicipality(),
    update: isPlatformOrMunicipalityAdmin(),
    delete: isPlatformOrMunicipalityAdmin(),
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
      // A fingerprint of what was last read — an unchanged page isn't sent to the AI again.
      name: 'lastContentHash',
      type: 'text',
      access: {
        read: ({ req }) => req.user?.role === 'admin',
        create: () => false,
        update: () => false,
      },
      admin: { hidden: true },
    },
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
