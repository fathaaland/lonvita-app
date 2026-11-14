/**
 * Run after restoring the database from a backup: deletes again every account deleted since the dump
 * (GDPR čl. 17), and every obec erased when its contract ended — see
 * src/lib/retention/replay-anonymizations.ts.
 *
 *   DATABASE_URI=<restored database> pnpm tsx scripts/replay-anonymizations.ts --since 2026-11-08 [--ids 12,34] [--apply]
 *
 * --since  the UTC day the dump was taken (its key in the backup bucket says it) — the audit copy is
 *          read from that day on, so a deletion made later that same day is caught too
 * --ids    extra user ids (deletions too recent for the nightly copy: the old database's audit log,
 *          `action = 'users.anonymize'`, created after the last copied day)
 * --apply  without it, a dry run: lists what would be anonymized
 * Needs AUDIT_EXPORT_BUCKET and the S3_* variables of the audit bucket.
 */
import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import {
  anonymizedIdsInAuditCopy,
  replayAnonymizations,
  replayMunicipalityErasures,
} from '../src/lib/retention/replay-anonymizations'

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : undefined
}

const since = arg('since')
if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('Usage: --since YYYY-MM-DD [--ids 1,2,3] [--apply]')
  process.exit(2)
}
const bucket = process.env.AUDIT_EXPORT_BUCKET?.trim()
if (!bucket) {
  console.error('AUDIT_EXPORT_BUCKET is not set')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
const extra = (arg('ids') ?? '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0)

const { ids, missingDays } = await anonymizedIdsInAuditCopy(bucket, since)
if (missingDays.length > 0) {
  console.warn(
    `No audit copy for: ${missingDays.join(', ')} — check the old database's audit log for those days and pass --ids.`,
  )
}
const all = [...new Set([...ids, ...extra])]
console.log(`${all.length} deleted account(s) since ${since}: ${all.join(', ') || '—'}`)

const erased = await anonymizedIdsInAuditCopy(bucket, since, new Date(), 'municipalities.erase')
console.log(`${erased.ids.length} erased obec/obce since ${since}: ${erased.ids.join(', ') || '—'}`)

const payload = await getPayload({ config })
const outcome = await replayAnonymizations(payload, all, { dryRun: !apply })
const obce = await replayMunicipalityErasures(payload, erased.ids, { dryRun: !apply })
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', accounts: outcome, obce }, null, 2))
const refused = outcome.refused.length + obce.refused.length
if (refused > 0) {
  console.error('Some were refused — settle them by hand (cancel their events), then run again.')
}
process.exit(refused > 0 ? 1 : 0)
