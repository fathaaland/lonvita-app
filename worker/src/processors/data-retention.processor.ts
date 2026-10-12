import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload'

import { recordAuditLog, type WriteAuditLogInput } from '@/collections/shared/auditLog'
import { logger, serializeError } from '@/lib/logger'
import { daysBefore, hoursBefore, monthsBefore, RETENTION, retentionMode, type RetentionMode } from '@/lib/retention/policy'

import { BATCH_SIZE, MAX_BATCHES } from '../runtime/batches'
import { getWorkerPayload } from '../runtime/payload'

import type { DataRetentionJobResult, DataRetentionStepResult } from '@/lib/queue/contracts'
import type { SQL } from 'drizzle-orm'
import type { CollectionSlug, Payload, PayloadRequest } from 'payload'
import { relationNumber } from '@/lib/relations'

/** Every delete this job makes passes this — nobody hears about a cancelled event going for good
 * (Events notifyOrganizersOnObecDelete), and the deletion hooks know it isn't a person's doing. */
const RETENTION_CONTEXT = { skipNotifications: true, dataRetention: true }

const cutoffsFor = (now: Date) => ({
  now: now.toISOString(),
  decidedRequest: daysBefore(now, RETENTION.decidedRequestDays).toISOString(),
  organizerRequest: monthsBefore(now, RETENTION.organizerRequestMonths).toISOString(),
  staleEventData: monthsBefore(now, RETENTION.staleEventDataMonths).toISOString(),
  orphanMedia: hoursBefore(now, RETENTION.orphanMediaGraceHours).toISOString(),
  // Never under the floor, whatever the policy says — the database would refuse it anyway.
  auditLog: monthsBefore(now, Math.max(RETENTION.auditLogMonths, RETENTION.auditLogMinimumMonths)).toISOString(),
})

type Cutoffs = ReturnType<typeof cutoffsFor>

type Step = {
  name: string
  collection: CollectionSlug
  /** The rule in words — written into the audit entry together with the ids. */
  rule: string
  /** The next `limit` ids after `afterId`, ascending — only rows the rule allows removing. Plain SQL
   * because most rules reach across tables (the event's start, whether anything points at a row). */
  select: (cutoffs: Cutoffs, afterId: number, limit: number) => SQL
  /** Removes the batch and writes its audit entry, in one transaction; returns how many went. */
  purge: (payload: Payload, step: Step, ids: number[]) => Promise<number>
}

const selectIds = async (payload: Payload, query: SQL): Promise<number[]> => {
  const { rows } = await (payload.db as unknown as PostgresAdapter).drizzle.execute(query)
  return (rows as { id: number | string }[]).map((row) => Number(row.id))
}

async function inTransaction<T>(payload: Payload, fn: (req: PayloadRequest) => Promise<T>): Promise<T> {
  const req = await createLocalReq({ context: RETENTION_CONTEXT }, payload)
  const shouldCommit = await initTransaction(req)
  try {
    const result = await fn(req)
    if (shouldCommit) await commitTransaction(req)
    return result
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    throw error
  }
}

const purgeEntry = (step: Step, ids: number[]): WriteAuditLogInput => ({
  action: 'data-retention.purge',
  targetCollection: step.collection,
  targetId: ids.length === 1 ? ids[0] : `${ids[0]}-${ids[ids.length - 1]}`,
  metadata: { step: step.name, rule: step.rule, count: ids.length, ids },
})

/** Rows with no hooks worth running — straight from the table, so a backlog doesn't become one CRUD
 * log line per row; the audit entry lists every id. Join tables (`*_rels`) go with them (ON DELETE CASCADE). */
const deleteRows: Step['purge'] = (payload, step, ids) =>
  inTransaction(payload, async (req) => {
    await payload.db.deleteMany({ collection: step.collection, where: { id: { in: ids } }, req })
    await recordAuditLog(payload, purgeEntry(step, ids), { req })
    return ids.length
  })

/** Through the Local API — the storage plugin's own afterDelete takes the files (original and every
 * size) off S3. One that fails stays for the next night. */
const deleteUploads: Step['purge'] = (payload, step, ids) =>
  inTransaction(payload, async (req) => {
    const result = await payload.delete({ collection: 'media', where: { id: { in: ids } }, overrideAccess: true, req })
    for (const failure of result.errors) {
      logger.warn('Orphaned upload not removed', { event: 'retention.media_purge_failed', mediaId: failure.id, message: failure.message })
    }
    const deleted = result.docs.map((doc) => Number(doc.id))
    if (deleted.length > 0) await recordAuditLog(payload, purgeEntry(step, deleted), { req })
    return deleted.length
  })

/** One at a time, each in a transaction of its own: deleting an event runs its cleanup
 * (Events cleanupEventRelations — registrations, invitations, ratings, photos) and takes its cover
 * off S3. Its own entry says what it was, since the row is all there was of it. */
const deleteEvents: Step['purge'] = async (payload, step, ids) => {
  let deleted = 0
  for (const id of ids) {
    try {
      await inTransaction(payload, async (req) => {
        const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true, req })
        // The entry first: deleting takes the cover off S3, which no rollback brings back.
        await recordAuditLog(
          payload,
          {
            action: 'events.purge',
            targetCollection: 'events',
            targetId: id,
            municipality: relationNumber(event.municipality),
            metadata: { step: step.name, rule: step.rule, title: event.title, dateTime: event.dateTime, cancelledAt: event.deletedAt ?? null },
          },
          { req },
        )
        await payload.delete({ collection: 'events', id, overrideAccess: true, req })
      })
      deleted++
    } catch (error) {
      logger.error('Cancelled event not purged', { event: 'retention.event_purge_failed', eventId: id, ...serializeError(error) })
    }
  }
  return deleted
}

/**
 * The rules, in the order they run — what refers to something goes before what it refers to. None of
 * them touches what an overview counts (lib/retention/policy.ts); the statistics come out the same
 * before and after (tests/int/data-retention.int.spec.ts checks exactly that).
 */
const STEPS: Step[] = [
  {
    name: 'decided-co-organizing-invitations',
    collection: 'co-organizing-requests',
    rule: `decided or lapsed ${RETENTION.decidedRequestDays}+ days ago, event started`,
    select: (c, afterId, limit) => sql`
      SELECT r.id FROM co_organizing_requests r JOIN events e ON e.id = r.event_id
      WHERE r.status IN ('approved', 'rejected', 'expired')
        AND coalesce(r.reviewed_at, r.expires_at) < ${c.decidedRequest}::timestamptz
        AND e.date_time < ${c.now}::timestamptz
        AND r.id > ${afterId}
      ORDER BY r.id LIMIT ${limit}`,
    purge: deleteRows,
  },
  {
    // A refused one stays open to escalation until the event starts (…/escalate) — not before then.
    name: 'settled-deletion-requests',
    collection: 'event-deletion-requests',
    rule: `settled ${RETENTION.decidedRequestDays}+ days ago, event started or gone`,
    select: (c, afterId, limit) => sql`
      SELECT r.id FROM event_deletion_requests r LEFT JOIN events e ON e.id = r.event_id
      WHERE r.status IN ('approved', 'rejected', 'expired', 'requester-removed', 'escalation-rejected')
        AND coalesce(r.decided_at, r.expires_at) < ${c.decidedRequest}::timestamptz
        AND (e.id IS NULL OR e.date_time < ${c.now}::timestamptz)
        AND r.id > ${afterId}
      ORDER BY r.id LIMIT ${limit}`,
    purge: deleteRows,
  },
  {
    // A rejected one never blocked asking again; an approved one lives on as the organizer role.
    name: 'decided-organizer-requests',
    collection: 'organizer-requests',
    rule: `decided ${RETENTION.organizerRequestMonths}+ months ago`,
    select: (c, afterId, limit) => sql`
      SELECT r.id FROM organizer_requests r
      WHERE r.status IN ('approved', 'rejected')
        AND coalesce(r.reviewed_at, r.updated_at) < ${c.organizerRequest}::timestamptz
        AND r.id > ${afterId}
      ORDER BY r.id LIMIT ${limit}`,
    purge: deleteRows,
  },
  {
    // Past the 30-day wait after a "no" (PoolInvitations) and the obec's "recent answers".
    name: 'answered-pool-invitations',
    collection: 'pool-invitations',
    rule: `answered ${RETENTION.decidedRequestDays}+ days ago`,
    select: (c, afterId, limit) => sql`
      SELECT r.id FROM pool_invitations r
      WHERE r.status IN ('accepted', 'declined', 'withdrawn')
        AND coalesce(r.decided_at, r.updated_at) < ${c.decidedRequest}::timestamptz
        AND r.id > ${afterId}
      ORDER BY r.id LIMIT ${limit}`,
    purge: deleteRows,
  },
  {
    // Accepted ones stay — they're how the volunteer came to be on the event.
    name: 'declined-volunteer-invitations',
    collection: 'volunteer-invitations',
    rule: `declined or withdrawn, event started ${RETENTION.decidedRequestDays}+ days ago`,
    select: (c, afterId, limit) => sql`
      SELECT r.id FROM volunteer_invitations r JOIN events e ON e.id = r.event_id
      WHERE r.status IN ('declined', 'withdrawn')
        AND e.date_time < ${c.decidedRequest}::timestamptz
        AND r.id > ${afterId}
      ORDER BY r.id LIMIT ${limit}`,
    purge: deleteRows,
  },
  {
    // Rejected ones stay (the "Zamítnuto" chart); approved ones are the statistics themselves.
    name: 'stale-registrations',
    collection: 'registrations',
    rule: `cancelled or never decided, event over ${RETENTION.staleEventDataMonths}+ months ago`,
    select: (c, afterId, limit) => sql`
      SELECT r.id FROM registrations r JOIN events e ON e.id = r.event_id
      WHERE r.status IN ('cancelled', 'pending')
        AND coalesce(e.end_date_time, e.date_time) < ${c.staleEventData}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM event_feedback f WHERE f.registration_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM volunteer_ratings v WHERE v.registration_id = r.id)
        AND r.id > ${afterId}
      ORDER BY r.id LIMIT ${limit}`,
    purge: deleteRows,
  },
  {
    // Invisible everywhere since it was called off (Events canReadEvent, analytics heldEvents).
    name: 'cancelled-events',
    collection: 'events',
    rule: `cancelled, ${RETENTION.staleEventDataMonths}+ months past its date and its cancellation`,
    select: (c, afterId, limit) => sql`
      SELECT e.id FROM events e
      WHERE (e.deleted_at IS NOT NULL OR e.status = 'cancelled')
        AND e.date_time < ${c.staleEventData}::timestamptz
        AND coalesce(e.deleted_at, e.updated_at) < ${c.staleEventData}::timestamptz
        AND e.id > ${afterId}
      ORDER BY e.id LIMIT ${limit}`,
    purge: deleteEvents,
  },
  {
    // A replaced or removed photo, a cover from a form never saved. Everything that may point at an
    // upload is listed here — a new upload field has to join this list.
    name: 'orphaned-uploads',
    collection: 'media',
    rule: `referenced by nothing, uploaded ${RETENTION.orphanMediaGraceHours}+ hours ago`,
    select: (c, afterId, limit) => sql`
      SELECT m.id FROM media m
      WHERE m.created_at < ${c.orphanMedia}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.image_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.avatar_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM event_media em WHERE em.media_id = m.id)
        AND m.id > ${afterId}
      ORDER BY m.id LIMIT ${limit}`,
    purge: deleteUploads,
  },
  {
    name: 'expired-audit-log',
    collection: 'audit-log',
    rule: `older than ${RETENTION.auditLogMonths} months`,
    select: (c, afterId, limit) => sql`
      SELECT a.id FROM audit_log a
      WHERE a.created_at < ${c.auditLog}::timestamptz
        AND a.id > ${afterId}
      ORDER BY a.id LIMIT ${limit}`,
    purge: deleteRows,
  },
]

async function runStep(payload: Payload, step: Step, cutoffs: Cutoffs, mode: RetentionMode): Promise<DataRetentionStepResult> {
  let afterId = 0
  let matched = 0
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const ids = await selectIds(payload, step.select(cutoffs, afterId, BATCH_SIZE))
    if (ids.length === 0) break
    matched += ids.length
    afterId = ids[ids.length - 1]
    if (mode === 'enforce') deleted += await step.purge(payload, step, ids)
    if (ids.length < BATCH_SIZE) break
  }
  return { matched, deleted }
}

export const processDataRetentionJob = async ({
  mode = retentionMode(),
  now = new Date(),
}: { mode?: RetentionMode; now?: Date } = {}): Promise<DataRetentionJobResult> => {
  const payload = await getWorkerPayload()
  const cutoffs = cutoffsFor(now)
  const steps: DataRetentionJobResult['steps'] = {}
  const failed: string[] = []

  // Each rule on its own: one that fails (a constraint nobody foresaw) doesn't keep the rest from running.
  for (const step of STEPS) {
    try {
      steps[step.name] = await runStep(payload, step, cutoffs, mode)
    } catch (error) {
      failed.push(step.name)
      logger.error('Data retention step failed', { event: 'retention.step_failed', step: step.name, mode, ...serializeError(error) })
    }
  }

  if (mode === 'enforce') {
    // That the rules were applied at all, and when — also on a night nothing was due.
    await recordAuditLog(payload, {
      action: 'data-retention.run',
      targetCollection: 'audit-log',
      targetId: cutoffs.now,
      metadata: { steps, failed, cutoffs },
    }).catch((error) => logger.error('Data retention run not recorded', { event: 'retention.run_record_failed', ...serializeError(error) }))
  }

  logger[failed.length > 0 ? 'error' : 'info']('Data retention finished', { event: 'retention.finished', mode, steps, failed })
  return { mode, steps, failed }
}
