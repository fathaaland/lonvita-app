import type { CollectionBeforeOperationHook, CollectionSlug, PayloadRequest, Where } from 'payload'
import { APIError } from 'payload'

import { READ_ONLY_MESSAGE, isReadOnly } from '@/lib/billing/status'

/** Whether the obec is read-only — once per request and obec. */
async function obecIsReadOnly(req: PayloadRequest, municipalityId: string): Promise<boolean> {
  const key = `obecReadOnly:${municipalityId}`
  const cached = req.context?.[key] as boolean | undefined
  if (cached !== undefined) return cached
  const obec = await req.payload
    .findByID({
      collection: 'municipalities',
      id: municipalityId,
      select: { billingStatus: true },
      depth: 0,
      overrideAccess: true,
      req,
    })
    .catch(() => null)
  const readOnly = isReadOnly(obec?.billingStatus)
  if (req.context) req.context[key] = readOnly
  return readOnly
}

/**
 * Refuses a write a person makes for a read-only obec. Trusted internal writes (no user — the worker,
 * seeds) and the platform's admins pass: the platform is who sorts the obec out.
 */
export async function assertObecWritable(req: PayloadRequest, municipalityId: string | number | null | undefined) {
  if (!req.user || req.user.role === 'admin' || municipalityId == null || municipalityId === '') return
  if (await obecIsReadOnly(req, String(municipalityId))) throw new APIError(READ_ONLY_MESSAGE, 403)
}

/** The obec an event belongs to — for records that hang off an event (invitations, requests). */
export async function municipalityOfEvent(req: PayloadRequest, eventId: unknown): Promise<string | null> {
  const id = relationValue(eventId)
  if (id == null || id === '') return null
  const event = await req.payload
    .findByID({ collection: 'events', id: id as number, select: { municipality: true }, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  const m = relationValue(event?.municipality)
  return m == null ? null : String(m)
}

const relationValue = (value: unknown): unknown =>
  value && typeof value === 'object' ? (value as { id?: unknown }).id : value

type Record_ = Record<string, unknown>

/**
 * A beforeOperation hook refusing what a person writes for a read-only obec (lib/billing/status).
 * Only writes under access control (every REST request — `overrideAccess: false`): the app's own
 * trusted writes on someone's behalf (an event flipped to full by a registration, a role granted by an
 * approved request) go through. `municipalityOf` finds the obec of the record — of the incoming data
 * on create, of each stored record on update; `skip` lets an update through that protects people
 * (an event cancelled).
 */
export const guardReadOnlyObec =
  (options: {
    collection: CollectionSlug
    operations: ('create' | 'update')[]
    municipalityOf: (record: Record_, req: PayloadRequest) => Promise<unknown> | unknown
    skip?: (data: Record_) => boolean
  }): CollectionBeforeOperationHook =>
  async ({ args, operation, req }) => {
    const { data, id, where, overrideAccess } = args as {
      data?: Record_
      id?: number | string
      where?: Where
      overrideAccess?: boolean
    }
    if (overrideAccess !== false || !req.user || req.user.role === 'admin') return args
    if (operation !== 'create' && operation !== 'update') return args
    if (!options.operations.includes(operation)) return args
    // Only an update may be let through — a create always takes something new on.
    if (operation === 'update' && data && options.skip?.(data)) return args

    if (operation === 'create') {
      await assertObecWritable(req, relationValue(await options.municipalityOf(data ?? {}, req)) as string | number)
      return args
    }
    const stored = await req.payload.find({
      collection: options.collection,
      where: id !== undefined ? { id: { equals: id } } : (where ?? {}),
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
    for (const doc of stored.docs as unknown as Record_[]) {
      await assertObecWritable(req, relationValue(await options.municipalityOf(doc, req)) as string | number)
    }
    return args
  }
