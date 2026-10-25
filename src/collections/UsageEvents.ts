import type { CollectionConfig } from 'payload'

const adminOnly = ({ req: { user } }: { req: { user: { role?: string } | null } }) =>
  user?.role === 'admin'

export const USAGE_EVENT_OPERATION_TYPES = ['event_import', 'event_import_details'] as const

export type UsageEventOperationType = (typeof USAGE_EVENT_OPERATION_TYPES)[number]

export const USAGE_EVENT_SOURCES = ['api', 'worker'] as const

export type UsageEventSource = (typeof USAGE_EVENT_SOURCES)[number]

export const USAGE_EVENT_KINDS = ['tokens', 'search_units'] as const

export type UsageEventKind = (typeof USAGE_EVENT_KINDS)[number]

export const USAGE_EVENT_STATUSES = ['success', 'error', 'aborted'] as const

export type UsageEventStatus = (typeof USAGE_EVENT_STATUSES)[number]

/** Append-only ledger of every AI model call in the system — the source of truth for billing.
 * Ported from hbai-app (tenant → obec). */
export const UsageEvents: CollectionConfig = {
  slug: 'usage-events',
  labels: { singular: 'Usage Event', plural: 'Usage Events' },
  admin: {
    useAsTitle: 'operationType',
    defaultColumns: ['operationType', 'provider', 'model', 'totalTokens', 'costUsd', 'createdAt'],
  },
  access: {
    read: adminOnly,
    // Rows are only ever written server-side via recordUsageEvent (overrideAccess: true) —
    // no client should be able to create billing rows directly through the API.
    create: () => false,
    update: () => false,
    // Nor deleted through it — the ledger is what the obce's imports cost; a row gone from it is
    // spend nobody sees, and under the obec's fair-use cap again.
    delete: () => false,
  },
  fields: [
    {
      // Who the call is billed to — an organizer's import counts against the obec of their
      // organization. Empty once the obec is deleted; the row stays.
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      label: 'Municipality',
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      label: 'User',
      admin: {
        position: 'sidebar',
        description: 'Empty for system/background jobs with no interactive user.',
      },
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      label: 'Organization',
      admin: { position: 'sidebar' },
    },
    {
      name: 'eventSource',
      type: 'relationship',
      relationTo: 'event-sources',
      label: 'Event Source',
      admin: { position: 'sidebar' },
    },
    {
      name: 'importRun',
      type: 'relationship',
      relationTo: 'import-runs',
      label: 'Import Run',
      admin: { position: 'sidebar' },
    },
    {
      name: 'provider',
      type: 'text',
      required: true,
      label: 'Provider',
    },
    {
      name: 'model',
      type: 'text',
      required: true,
      label: 'Model',
    },
    {
      name: 'operationType',
      type: 'select',
      required: true,
      label: 'Operation Type',
      options: USAGE_EVENT_OPERATION_TYPES.map((value) => ({ label: value, value })),
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      label: 'Source',
      options: USAGE_EVENT_SOURCES.map((value) => ({ label: value, value })),
    },
    {
      name: 'usageKind',
      type: 'select',
      required: true,
      label: 'Usage Kind',
      options: USAGE_EVENT_KINDS.map((value) => ({ label: value, value })),
    },
    {
      name: 'inputTokens',
      type: 'number',
      label: 'Input Tokens',
      admin: { readOnly: true },
    },
    {
      name: 'outputTokens',
      type: 'number',
      label: 'Output Tokens',
      admin: { readOnly: true },
    },
    {
      name: 'cachedInputTokens',
      type: 'number',
      label: 'Cached Input Tokens',
      admin: { readOnly: true },
    },
    {
      name: 'reasoningTokens',
      type: 'number',
      label: 'Reasoning Tokens',
      admin: { readOnly: true },
    },
    {
      name: 'totalTokens',
      type: 'number',
      label: 'Total Tokens',
      admin: { readOnly: true },
    },
    {
      name: 'searchUnits',
      type: 'number',
      label: 'Search Units',
      admin: {
        readOnly: true,
        description: 'Used when usageKind is search_units (e.g. Cohere rerank).',
      },
    },
    {
      name: 'inputPricePerMTok',
      type: 'number',
      label: 'Input Price / MTok (USD)',
      admin: { readOnly: true, description: 'Price snapshot at call time.' },
    },
    {
      name: 'outputPricePerMTok',
      type: 'number',
      label: 'Output Price / MTok (USD)',
      admin: { readOnly: true, description: 'Price snapshot at call time.' },
    },
    {
      name: 'costUsd',
      type: 'number',
      label: 'Cost (USD)',
      admin: { readOnly: true, description: 'Null when pricing is unknown for this model.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      label: 'Status',
      options: USAGE_EVENT_STATUSES.map((value) => ({ label: value, value })),
    },
    {
      name: 'requestId',
      type: 'text',
      label: 'Request ID',
      index: true,
      admin: {
        description:
          "The provider's request id (Anthropic request-id) — what its own records know the call by.",
      },
    },
  ],
  timestamps: true,
}
