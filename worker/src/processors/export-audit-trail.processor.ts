import { createHash } from 'node:crypto'

import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import { recordAuditLog } from '@/collections/shared/auditLog'
import { logger, serializeError } from '@/lib/logger'
import { monthsBefore } from '@/lib/retention/policy'
import { getRetention } from '@/lib/retention/settings'
import { getS3Client } from '@/lib/s3/client'

import { getWorkerPayload } from '../runtime/payload'

import type { ExportAuditTrailJobResult } from '@/lib/queue/contracts'
import type { Payload } from 'payload'

/** How far back a run looks for a day not yet in the bucket — two months of missed nights are caught
 * up (one HEAD request per day already there). Data retention removes only days that made it. */
const LOOKBACK_DAYS = 60

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` of the UTC day `daysAgo` before `now`. */
const utcDay = (now: Date, daysAgo: number): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * DAY_MS)
    .toISOString()
    .slice(0, 10)

const keyFor = (day: string) => `audit-trail/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.jsonl`

/** Marks which S3 call failed — the SDK's own error is a bare `UnknownError` when R2 sends no XML body. */
const failedAt = (operation: 'HEAD' | 'PUT' | 'DELETE', error: unknown): Error => {
  const meta = error as { $metadata?: { httpStatusCode?: number }; Code?: string; name?: string }
  return Object.assign(
    new Error(
      `S3 ${operation} failed: HTTP ${meta.$metadata?.httpStatusCode ?? '?'} ${meta.Code ?? meta.name ?? ''}`.trim(),
    ),
    { cause: error },
  )
}

const exists = async (bucket: string, key: string): Promise<boolean> => {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) return false
    throw failedAt('HEAD', error)
  }
}

/**
 * How the file is kept write-once. AWS S3 and MinIO take a compliance-mode lock on each object. R2
 * can't (its S3 API rejects the object-lock headers): there a bucket lock rule on the audit bucket
 * keeps every object for the retention period instead, and the upload must not carry the headers.
 * AUDIT_EXPORT_LOCK=bucket|object overrides the guess from S3_ENDPOINT.
 */
export const auditExportLockMode = (env: NodeJS.ProcessEnv = process.env): 'object' | 'bucket' => {
  const explicit = env.AUDIT_EXPORT_LOCK?.trim().toLowerCase()
  if (explicit === 'bucket' || explicit === 'object') return explicit
  return /\.r2\.cloudflarestorage\.com/i.test(env.S3_ENDPOINT ?? '') ? 'bucket' : 'object'
}

export class AuditLockNotEnforcedError extends Error {
  name = 'AuditLockNotEnforcedError'
}

const statusOf = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode

/**
 * Proves, each run, that the bucket really keeps what is written to it — the configuration lives
 * outside the app (R2's bucket lock rule can be removed in the Cloudflare dashboard; an S3 bucket can
 * lose its Object Lock default), and a copy that can be deleted is no write-once copy: data retention
 * would then remove rows whose only lasting record is gone.
 * - object lock (S3, MinIO): a probe written with a COMPLIANCE lock must read back with it, retained
 *   for the period asked;
 * - bucket lock (R2): deleting the probe must be refused. R2 can't report the rule's period over the
 *   S3 API — the 18 months are checked in the dashboard (the probe proves a rule covers audit-trail/).
 * The probe stays in the bucket, locked like the rest: one small file a night, under audit-trail/_probe/.
 */
export const verifyWriteOnce = async (
  bucket: string,
  lockMonths: number,
  now: Date,
): Promise<void> => {
  const mode = auditExportLockMode()
  const key = `audit-trail/_probe/${now.toISOString()}.txt`
  const retainUntil = monthsBefore(now, -lockMonths)
  await getS3Client()
    .send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: `write-once probe ${now.toISOString()}\n`,
        ContentType: 'text/plain',
        ChecksumAlgorithm: 'SHA256',
        ...(mode === 'object'
          ? { ObjectLockMode: 'COMPLIANCE' as const, ObjectLockRetainUntilDate: retainUntil }
          : {}),
      }),
    )
    .catch((error) => {
      // A bucket created without Object Lock refuses the lock headers with a 400.
      if (mode === 'object' && statusOf(error) === 400) {
        throw new AuditLockNotEnforcedError(
          `Bucket ${bucket} refused an object lock — Object Lock isn't enabled on it`,
        )
      }
      throw failedAt('PUT', error)
    })

  if (mode === 'object') {
    const head = await getS3Client()
      .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      .catch((error) => {
        throw failedAt('HEAD', error)
      })
    const until = head.ObjectLockRetainUntilDate ? new Date(head.ObjectLockRetainUntilDate) : null
    // A day's slack for clock and rounding differences.
    if (
      head.ObjectLockMode !== 'COMPLIANCE' ||
      !until ||
      until.getTime() < retainUntil.getTime() - 24 * 3600_000
    ) {
      throw new AuditLockNotEnforcedError(
        `Bucket ${bucket} did not keep the probe under a COMPLIANCE lock until ${retainUntil.toISOString().slice(0, 10)} (got ${head.ObjectLockMode ?? 'no lock'}, ${until?.toISOString().slice(0, 10) ?? '-'})`,
      )
    }
    return
  }

  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  } catch (error) {
    // Refused — the lock rule holds. Anything but a refusal (a 5xx, a timeout) is a failed check, not a pass.
    const status = statusOf(error)
    if (status !== undefined && status >= 400 && status < 500) return
    throw failedAt('DELETE', error)
  }
  // R2 answers a DELETE of a locked object with an error; a 204 means it's gone. Make sure.
  const stillThere = await exists(bucket, key)
  if (!stillThere) {
    throw new AuditLockNotEnforcedError(
      `Bucket ${bucket} let the probe ${key} be deleted — no bucket lock rule covers audit-trail/`,
    )
  }
}

/** Every row of `table` created on `day`, whole, as the database holds it. */
const rowsOf = async (payload: Payload, table: 'audit_log' | 'security_events', day: string) => {
  const from = `${day}T00:00:00.000Z`
  const to = new Date(new Date(from).getTime() + DAY_MS).toISOString()
  const { rows } = await (payload.db as unknown as PostgresAdapter).drizzle.execute(sql`
    SELECT row_to_json(t) AS row FROM ${sql.raw(table)} t
    WHERE t.created_at >= ${from}::timestamptz AND t.created_at < ${to}::timestamptz
    ORDER BY t.id`)
  return (rows as { row: unknown }[]).map((r) => r.row)
}

/**
 * One finished UTC day of the audit log and the security events, written once to the write-once
 * bucket: a manifest line first, then a line per row. Compliance-mode Object Lock (or, on R2, the
 * bucket's lock rule — auditExportLockMode) keeps it from being changed or removed by anybody — this
 * app's credentials included — for 18 months. Its hash
 * goes into the audit log, so each night's file is vouched for by the next.
 */
const exportDay = async (
  payload: Payload,
  bucket: string,
  day: string,
  now: Date,
  lockMonths: number,
) => {
  const auditLog = await rowsOf(payload, 'audit_log', day)
  const securityEvents = await rowsOf(payload, 'security_events', day)
  const lines = [
    JSON.stringify({
      type: 'manifest',
      day,
      generatedAt: now.toISOString(),
      auditLogCount: auditLog.length,
      securityEventCount: securityEvents.length,
    }),
    ...auditLog.map((row) => JSON.stringify({ type: 'audit-log', row })),
    ...securityEvents.map((row) => JSON.stringify({ type: 'security-event', row })),
  ]
  const body = Buffer.from(`${lines.join('\n')}\n`, 'utf8')
  const sha256 = createHash('sha256').update(body).digest('hex')
  const key = keyFor(day)

  await getS3Client()
    .send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/x-ndjson',
        ChecksumAlgorithm: 'SHA256',
        ...(auditExportLockMode() === 'object'
          ? {
              ObjectLockMode: 'COMPLIANCE' as const,
              ObjectLockRetainUntilDate: monthsBefore(now, -lockMonths),
            }
          : {}),
        Metadata: { sha256 },
      }),
    )
    .catch((error) => {
      throw failedAt('PUT', error)
    })

  await recordAuditLog(payload, {
    action: 'audit-trail.exported',
    targetCollection: 'audit-log',
    targetId: day,
    metadata: {
      bucket,
      key,
      sha256,
      lock: auditExportLockMode(),
      auditLogCount: auditLog.length,
      securityEventCount: securityEvents.length,
    },
  })
}

export const processExportAuditTrailJob = async (): Promise<ExportAuditTrailJobResult> => {
  const bucket = process.env.AUDIT_EXPORT_BUCKET?.trim()
  if (!bucket) {
    // Loud in production: without the copy, data retention keeps the audit log and security events.
    logger[process.env.NODE_ENV === 'production' ? 'error' : 'warn'](
      'Audit trail not exported — no bucket configured',
      {
        event: 'audit_export.not_configured',
      },
    )
    return { exported: [], failed: [], skipped: 'not_configured' }
  }

  const payload = await getWorkerPayload()
  // Never under the 18 months of vyhláška 409/2025 Sb. — the settings' floor (lib/retention/settings).
  const lockMonths = (await getRetention(payload)).auditExportMonths
  const now = new Date()
  const result: ExportAuditTrailJobResult = { exported: [], failed: [] }

  try {
    await verifyWriteOnce(bucket, lockMonths, now)
  } catch (error) {
    if (!(error instanceof AuditLockNotEnforcedError)) {
      // S3 unreachable or refusing the upload — same as a day that failed: tried again tomorrow.
      logger.error('Audit bucket check failed — nothing exported', {
        event: 'audit_export.probe_failed',
        bucket,
        ...serializeError(error),
      })
      return { ...result, skipped: 'probe_failed' }
    }
    // No day is marked exported, so data retention keeps the audit log and security events in the
    // database until the bucket is fixed — the next night catches up on every missed day.
    logger.error('Audit bucket is not write-once — nothing exported', {
      event: 'audit_export.lock_not_enforced',
      bucket,
      lock: auditExportLockMode(),
      ...serializeError(error),
    })
    return { ...result, skipped: 'lock_not_enforced' }
  }

  // Oldest first; today is still being written, so it waits for tomorrow night.
  for (let daysAgo = LOOKBACK_DAYS; daysAgo >= 1; daysAgo--) {
    const day = utcDay(now, daysAgo)
    try {
      if (await exists(bucket, keyFor(day))) continue
      await exportDay(payload, bucket, day, now, lockMonths)
      result.exported.push(day)
    } catch (error) {
      result.failed.push(day)
      logger.error('Audit trail day not exported', {
        event: 'audit_export.day_failed',
        day,
        bucket,
        ...serializeError(error),
      })
    }
  }

  logger.info('Audit trail exported', { event: 'audit_export.finished', bucket, ...result })
  return result
}
