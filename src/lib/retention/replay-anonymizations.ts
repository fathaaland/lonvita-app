import { GetObjectCommand } from '@aws-sdk/client-s3'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
} from 'payload'

import { anonymizeUser, removeAnonymizedFiles } from '@/collections/shared/anonymizeUser'
import { recordAuditLog } from '@/collections/shared/auditLog'
import { getS3Client } from '@/lib/s3/client'

/**
 * After a restore from backup (.github/workflows/backup.yml), every account deleted since the dump is
 * back with its personal data — GDPR čl. 17 says it has to go again. The deletions are on the record
 * twice: the `users.anonymize` entries of the audit log, and their nightly write-once copy in the audit
 * bucket (audit-trail/YYYY/MM/YYYY-MM-DD.jsonl), which survives whatever happened to the database.
 * This reads the copy from the dump's day on, plus ids given by hand (deletions of the last day, not
 * copied yet — from the old database's audit log if it's still reachable), and anonymizes each account
 * the restored database still has. CLI: scripts/replay-anonymizations.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const keyFor = (day: string) => `audit-trail/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.jsonl`

const daysFrom = (since: string, until: Date): string[] => {
  const days: string[] = []
  for (let t = Date.parse(`${since}T00:00:00Z`); t < until.getTime(); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10))
  }
  return days
}

/** User ids whose `users.anonymize` entries are in the audit bucket's files for these days. */
export async function anonymizedIdsInAuditCopy(
  bucket: string,
  since: string,
  until = new Date(),
): Promise<{ ids: number[]; missingDays: string[] }> {
  const ids = new Set<number>()
  const missingDays: string[] = []
  for (const day of daysFrom(since, until)) {
    let body: string
    try {
      const object = await getS3Client().send(
        new GetObjectCommand({ Bucket: bucket, Key: keyFor(day) }),
      )
      body = (await object.Body?.transformToString('utf8')) ?? ''
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        missingDays.push(day)
        continue
      }
      throw error
    }
    for (const line of body.split('\n')) {
      if (!line.trim()) continue
      const entry = JSON.parse(line) as {
        type?: string
        row?: { action?: string; target_id?: string; outcome?: string }
      }
      if (entry.type !== 'audit-log' || entry.row?.action !== 'users.anonymize') continue
      if (entry.row.outcome && entry.row.outcome !== 'success') continue
      const id = Number(entry.row.target_id)
      if (Number.isInteger(id) && id > 0) ids.add(id)
    }
  }
  return { ids: [...ids].sort((a, b) => a - b), missingDays }
}

export type ReplayOutcome = {
  anonymized: number[]
  alreadyGone: number[]
  /** Refused by anonymizeUser (e.g. an event ahead they still run) — to be settled by hand. */
  refused: { id: number; reason: string }[]
}

/** Anonymizes each listed account the database still holds; `dryRun` only reports. */
export async function replayAnonymizations(
  payload: Payload,
  userIds: number[],
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = { anonymized: [], alreadyGone: [], refused: [] }
  for (const id of userIds) {
    const user = await payload
      .findByID({ collection: 'users', id, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (!user || user.anonymizedAt) {
      outcome.alreadyGone.push(id)
      continue
    }
    if (dryRun) {
      outcome.anonymized.push(id)
      continue
    }
    const req = await createLocalReq({}, payload)
    const shouldCommit = await initTransaction(req)
    try {
      const files = await anonymizeUser(req, id)
      await recordAuditLog(
        payload,
        {
          action: 'users.anonymize-replayed',
          targetCollection: 'users',
          targetId: id,
          metadata: { reason: 'restored from backup — the deletion predates the restore' },
        },
        { req },
      )
      if (shouldCommit) await commitTransaction(req)
      await removeAnonymizedFiles(payload, id, files)
      outcome.anonymized.push(id)
    } catch (error) {
      if (shouldCommit) await killTransaction(req)
      outcome.refused.push({ id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return outcome
}
