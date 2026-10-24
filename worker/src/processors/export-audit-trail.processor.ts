import { createHash } from 'node:crypto'

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import { recordAuditLog } from '@/collections/shared/auditLog'
import { logger, serializeError } from '@/lib/logger'
import { monthsBefore, RETENTION } from '@/lib/retention/policy'
import { getS3Client } from '@/lib/s3/client'

import { getWorkerPayload } from '../runtime/payload'

import type { ExportAuditTrailJobResult } from '@/lib/queue/contracts'
import type { Payload } from 'payload'

/** How far back a run looks for a day not yet in the bucket — a week of missed nights is caught up. */
const LOOKBACK_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` of the UTC day `daysAgo` before `now`. */
const utcDay = (now: Date, daysAgo: number): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * DAY_MS)
    .toISOString()
    .slice(0, 10)

const keyFor = (day: string) => `audit-trail/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.jsonl`

const exists = async (bucket: string, key: string): Promise<boolean> => {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) return false
    throw error
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
 * bucket: a manifest line first, then a line per row. Compliance-mode Object Lock keeps it from
 * being changed or removed by anybody — this app's credentials included — for 18 months. Its hash
 * goes into the audit log, so each night's file is vouched for by the next.
 */
const exportDay = async (payload: Payload, bucket: string, day: string, now: Date) => {
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

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/x-ndjson',
      ChecksumAlgorithm: 'SHA256',
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: monthsBefore(now, -RETENTION.auditExportMonths),
      Metadata: { sha256 },
    }),
  )

  await recordAuditLog(payload, {
    action: 'audit-trail.exported',
    targetCollection: 'audit-log',
    targetId: day,
    metadata: {
      bucket,
      key,
      sha256,
      auditLogCount: auditLog.length,
      securityEventCount: securityEvents.length,
    },
  })
}

export const processExportAuditTrailJob = async (): Promise<ExportAuditTrailJobResult> => {
  const bucket = process.env.AUDIT_EXPORT_BUCKET?.trim()
  if (!bucket) {
    logger.warn('Audit trail not exported — no bucket configured', {
      event: 'audit_export.not_configured',
    })
    return { exported: [], failed: [], skipped: 'not_configured' }
  }

  const payload = await getWorkerPayload()
  const now = new Date()
  const result: ExportAuditTrailJobResult = { exported: [], failed: [] }

  // Oldest first; today is still being written, so it waits for tomorrow night.
  for (let daysAgo = LOOKBACK_DAYS; daysAgo >= 1; daysAgo--) {
    const day = utcDay(now, daysAgo)
    try {
      if (await exists(bucket, keyFor(day))) continue
      await exportDay(payload, bucket, day, now)
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
