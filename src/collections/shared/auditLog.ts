import type { CollectionAfterDeleteHook, Payload, PayloadRequest, RequestContext } from 'payload'

import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders, getCorrelationId, NO_CORRELATION_ID } from '@/lib/logger/correlation'
import { getClientIp } from '@/lib/security/rate-limit'

/** A Payload `req` (hooks) or a route's `Request` — the headers are all that's read from either.
 * On the Local API Payload hands over a plain object instead of `Headers`, so both shapes. */
type AuditSource = { headers?: unknown } | null | undefined

export type AuditOutcome = 'success' | 'failure'

export type WriteAuditLogInput = {
  action: string
  actor?: number | null
  targetCollection: string
  targetId: string | number
  municipality?: number | null
  metadata?: Record<string, unknown>
  /** 'failure' for an attempt that was refused — the attempt is what's worth knowing about. */
  outcome?: AuditOutcome
  /** What carried the action: the originator's device (IP address, browser) and the request's trace
   * id come from it. None for the system's own jobs. */
  source?: AuditSource
}

const USER_AGENT_MAX_LENGTH = 512

const readHeader = (headers: unknown, name: string): string | null => {
  if (!headers) return null
  const getter = (headers as { get?: unknown }).get
  if (typeof getter === 'function') return ((getter as (n: string) => string | null | undefined).call(headers, name) ?? null) || null
  const value = (headers as Record<string, unknown>)[name]
  return typeof value === 'string' && value ? value : null
}

/** Who did it from where — what the cybersecurity regulation asks of every entry besides the time,
 * the action and its outcome (vyhláška č. 409/2025 Sb. § 22 odst. 4). */
const originOf = (source: AuditSource) => {
  const headers = source?.headers
  if (!headers) return { ipAddress: null, userAgent: null, correlationId: null }
  const ip = getClientIp({ get: (name) => readHeader(headers, name) })
  const correlationId = correlationIdFromHeaders(headers as Parameters<typeof correlationIdFromHeaders>[0])
  return {
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: readHeader(headers, 'user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
    correlationId: correlationId === NO_CORRELATION_ID ? null : correlationId,
  }
}

/**
 * An audit entry that must exist for the operation to count — awaited, and failing loudly. Pass the
 * `req` of a transaction and the entry commits or rolls back together with what it records (the
 * data-retention job deletes nothing without one).
 */
export async function recordAuditLog(
  payload: Payload,
  input: WriteAuditLogInput,
  { req }: { req?: PayloadRequest } = {},
): Promise<void> {
  const entry = {
    action: input.action,
    outcome: input.outcome ?? 'success',
    targetCollection: input.targetCollection,
    targetId: String(input.targetId),
    metadata: input.metadata,
    ...originOf(input.source),
  }
  // What goes to the log stream — the same entry, with the job's or request's trace id when the
  // source carried none (the logger's own fallback would be overwritten by the null).
  const shipped = {
    event: 'audit.entry',
    ...entry,
    correlationId: entry.correlationId ?? getCorrelationId(),
    actorId: input.actor ?? null,
    municipalityId: input.municipality ?? null,
  }
  try {
    await payload.create({
      collection: 'audit-log',
      data: { ...entry, actor: input.actor ?? undefined, municipality: input.municipality ?? undefined },
      overrideAccess: true,
      req,
    })
  } catch (error) {
    // The copy outside the app still says it happened, even when the database wouldn't take it.
    logger.audit('Audit entry not stored', { ...shipped, stored: false, ...serializeError(error) })
    throw error
  }
  // Inside a transaction (`req`) this goes out once the row is written, before the commit — a
  // rollback afterwards leaves the copy recording an attempt the database doesn't have.
  logger.audit('Audit entry', { ...shipped, stored: true })
}

/** Fire-and-forget audit entry — a failed log write must never block the operation it's logging. */
export const writeAuditLog = (payload: Payload, input: WriteAuditLogInput): void => {
  recordAuditLog(payload, input).catch((error) =>
    payload.logger.error({ err: error, action: input.action }, 'Failed to write audit log entry'),
  )
}

type DeletedRecord = { municipality?: number | null; metadata: Record<string, unknown> }

/**
 * afterDelete: a person removing a record writes down what it was — the row itself is gone. Only
 * with a signed-in user: a script's deletes (tests, seeds) aren't anyone's doing, and the system's
 * own carry their entries (data-retention). `skip` leaves out the deletes another entry covers.
 */
export const auditDeletion =
  <Doc>(describe: (doc: Doc) => DeletedRecord, skip?: (context: RequestContext) => boolean): CollectionAfterDeleteHook =>
    ({ collection, context, doc, id, req }) => {
      if (!req.user || skip?.(context)) return doc
      const { municipality, metadata } = describe(doc)
      writeAuditLog(req.payload, {
        action: `${collection.slug}.delete`,
        actor: Number(req.user.id),
        targetCollection: collection.slug,
        targetId: id,
        municipality,
        metadata,
        source: req,
      })
      return doc
    }
