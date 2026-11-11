// Read-only check of every third-party service the worker uses, with the credentials it has — nothing
// is sent, written or changed, and no secret is printed. Run with the worker's environment:
//
//   railway run --service lonvita-app node scripts/check-services.mjs
//
// Each line: OK / WARN / FAIL, the service, what was found.
import {
  GetBucketLifecycleConfigurationCommand,
  GetObjectLockConfigurationCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3'

const env = process.env
const out = []
const say = (level, service, message) => out.push(`${level.padEnd(4)}  ${service.padEnd(10)}  ${message}`)
const time = (ms) => AbortSignal.timeout(ms)

async function bulkgate() {
  if (!env.BULKGATE_APPLICATION_ID || !env.BULKGATE_APPLICATION_TOKEN) return say('FAIL', 'BulkGate', 'BULKGATE_APPLICATION_ID / _TOKEN missing — no SMS goes out')
  const res = await fetch('https://portal.bulkgate.com/api/1.0/simple/info', {
    method: 'POST',
    signal: time(10_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ application_id: env.BULKGATE_APPLICATION_ID, application_token: env.BULKGATE_APPLICATION_TOKEN }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.data) return say('FAIL', 'BulkGate', `credentials refused (${res.status} ${body.type ?? body.error ?? ''})`)
  const credit = Number(body.data.credit)
  say(credit > 0 ? 'OK' : 'FAIL', 'BulkGate', `credentials valid, credit ${body.data.credit} ${body.data.currency ?? ''}, sender ${env.BULKGATE_SENDER_ID || 'gSystem'}${env.BULKGATE_SENDER_ID_VALUE ? ' (value set)' : ''}`)
}

async function resend() {
  if (!env.RESEND_API_KEY) return say('FAIL', 'Resend', 'RESEND_API_KEY missing — no e-mail goes out')
  const from = (env.RESEND_FROM_EMAIL || '').trim()
  const domain = from.split('@')[1]?.toLowerCase()
  if (!domain) return say('FAIL', 'Resend', 'RESEND_FROM_EMAIL missing or not an address')
  const res = await fetch('https://api.resend.com/domains', { signal: time(10_000), headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } })
  if (res.status === 401 || res.status === 403) {
    // A sending-only key can't list domains — then only a real send would tell.
    const body = await res.json().catch(() => ({}))
    return say('WARN', 'Resend', `key valid for sending only? cannot list domains (${res.status} ${body.name ?? ''}) — check the domain ${domain} in the Resend dashboard`)
  }
  const body = await res.json().catch(() => ({}))
  const found = (body.data ?? []).find((d) => d.name?.toLowerCase() === domain)
  if (!found) return say('FAIL', 'Resend', `sender domain ${domain} is not in the account — e-mails go only to the account owner`)
  say(found.status === 'verified' ? 'OK' : 'FAIL', 'Resend', `sender domain ${domain}: ${found.status}`)
}

function s3() {
  return new S3Client({
    region: env.S3_REGION || 'auto',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID || '', secretAccessKey: env.S3_SECRET_ACCESS_KEY || '' },
  })
}

async function bucket(name, label) {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: name }))
    say('OK', 'R2', `${label} bucket reachable`)
    return true
  } catch (error) {
    say('FAIL', 'R2', `${label} bucket not reachable (${error.name}: ${error.$metadata?.httpStatusCode ?? ''})`)
    return false
  }
}

async function r2() {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return say('FAIL', 'R2', 'S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY missing')
  await bucket(env.S3_BUCKET, 'photos/exports')
  if (!env.AUDIT_EXPORT_BUCKET) return say('FAIL', 'R2', 'AUDIT_EXPORT_BUCKET missing — no write-once copy of the audit log')
  if (!(await bucket(env.AUDIT_EXPORT_BUCKET, 'audit'))) return
  try {
    const lock = await s3().send(new GetObjectLockConfigurationCommand({ Bucket: env.AUDIT_EXPORT_BUCKET }))
    const rule = lock.ObjectLockConfiguration?.Rule?.DefaultRetention
    say(rule ? 'OK' : 'WARN', 'R2', rule ? `audit bucket object lock: ${rule.Mode ?? ''} ${rule.Days ?? ''}d ${rule.Years ?? ''}y` : 'audit bucket: no default object-lock retention read (R2 keeps its lock rules elsewhere — the worker probes them itself)')
  } catch (error) {
    say('WARN', 'R2', `audit bucket lock not readable through S3 (${error.name}) — on R2 the bucket lock rule is checked by the worker's own probe`)
  }
  try {
    const lc = await s3().send(new GetBucketLifecycleConfigurationCommand({ Bucket: env.AUDIT_EXPORT_BUCKET }))
    say('OK', 'R2', `audit bucket lifecycle rules: ${lc.Rules?.length ?? 0}`)
  } catch (error) {
    say('WARN', 'R2', `audit bucket has no lifecycle rule (${error.name}) — old copies are never removed`)
  }
}

async function anthropic() {
  if (!env.ANTHROPIC_API_KEY) return say('WARN', 'Anthropic', 'ANTHROPIC_API_KEY missing — import reads iCal/schema.org only')
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    signal: time(10_000),
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
  })
  say(res.ok ? 'OK' : 'FAIL', 'Anthropic', res.ok ? 'key valid' : `key refused (${res.status})`)
}

async function discord() {
  if (!env.OPS_DISCORD_WEBHOOK_URL) return say('WARN', 'Discord', 'OPS_DISCORD_WEBHOOK_URL missing — ops alerts by e-mail only')
  // GET on a webhook describes it and posts nothing.
  const res = await fetch(env.OPS_DISCORD_WEBHOOK_URL, { signal: time(10_000) })
  say(res.ok ? 'OK' : 'FAIL', 'Discord', res.ok ? 'ops webhook exists' : `ops webhook gone (${res.status})`)
}

function sentryAndRest() {
  say(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN ? 'OK' : 'WARN', 'Sentry', env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN ? 'DSN set' : 'no DSN — worker errors are not reported')
  say(env.OPS_ALERT_EMAILS ? 'OK' : 'WARN', 'Ops mail', env.OPS_ALERT_EMAILS ? 'alert addresses set' : 'OPS_ALERT_EMAILS missing')
  say(env.DATA_RETENTION_MODE === 'enforce' ? 'OK' : 'WARN', 'Retention', `DATA_RETENTION_MODE=${env.DATA_RETENTION_MODE || '(unset: dry run, nothing deleted)'}`)
  const db = env.DATABASE_URI || ''
  const user = db.match(/^[a-z]+:\/\/([^:@/]+)/)?.[1]
  say(user === 'lonvita_app' ? 'OK' : 'WARN', 'Database', `connects as ${user ?? '(unknown)'}${db.includes('-pooler') ? ', pooled' : ', direct'}`)
}

for (const check of [bulkgate, resend, r2, anthropic, discord]) {
  await check().catch((error) => say('FAIL', check.name, `check failed: ${error.name}: ${String(error.message).slice(0, 120)}`))
}
sentryAndRest()
console.log(out.join('\n'))
