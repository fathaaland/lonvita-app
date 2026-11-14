import { Redis } from 'ioredis'

import { scrubPii } from '@/lib/scrub-pii'
import { queueConnectionOptions } from '@/lib/valkey/client'

/**
 * The platform team's fast channel: a Discord webhook (OPS_DISCORD_WEBHOOK_URL) and an e-mail
 * (OPS_ALERT_EMAILS, comma-separated) for what needs a human now — the app or the worker crashing,
 * jobs lost for good, notifications stuck, data-retention or audit-copy failures, and signs of an
 * attack (bursts of failed logins or rate-limited requests).
 *
 * Fed by the logger (lib/logger: every line goes through `opsAlertFor`), so a call site only has to
 * log as it already does. Deliberately free of the logger itself — an alert that fails to go out
 * writes to the console and nothing else, or a broken webhook would log, alert, log…
 *
 * Sent straight to Discord and Resend, not through the job queue: the queue (Redis, the worker) is
 * among the things that may be down when the alert matters. Throttled per alert key through Redis
 * (in memory without it), so a crash loop is one message per quarter of an hour, not thousands.
 */

export type OpsSeverity = 'critical' | 'warning'

export type OpsAlert = {
  /** Same key = same incident; throttled together. */
  key: string
  severity: OpsSeverity
  title: string
  /** Short facts — no personal data: Discord and the mailbox are outside the app's data boundary. */
  details: Record<string, string | number | boolean | null | undefined>
}

type LogLine = {
  level: string
  message: string
  event: string | null
  service: string
  environment: string
  fields: Record<string, unknown>
}

const THROTTLE_SECONDS = 15 * 60

/** Shown in Discord as the embed colour. */
const COLOUR: Record<OpsSeverity, number> = { critical: 0xdc2626, warning: 0xf59e0b }

/** Lines that are an incident on their own. */
const IMMEDIATE: Record<string, { severity: OpsSeverity; title: string }> = {
  'worker.uncaught_exception': { severity: 'critical', title: 'Worker spadl (uncaught exception)' },
  'worker.unhandled_rejection': { severity: 'critical', title: 'Worker spadl (unhandled rejection)' },
  'worker.prototype_pollution_detected': { severity: 'critical', title: 'Worker: zjištěno prototype pollution' },
  'worker.shutdown_timed_out': { severity: 'warning', title: 'Worker se neukončil včas, joby zůstaly rozběhnuté' },
  'payload.unhandled_error': { severity: 'critical', title: 'Neošetřená chyba v aplikaci' },
  'outbox.stuck': { severity: 'critical', title: 'Kritická oznámení se zasekla v outboxu' },
  'outbox.relay_failed': { severity: 'warning', title: 'Outbox relay selhal' },
  'queue.email_backlog': { severity: 'warning', title: 'Hromadí se e-maily ve frontě' },
  'retention.step_failed': { severity: 'critical', title: 'Retence dat selhala' },
  'retention.event_purge_failed': { severity: 'critical', title: 'Retence dat: mazání akcí selhalo' },
  'retention.media_purge_failed': { severity: 'critical', title: 'Retence dat: mazání souborů selhalo' },
  'audit_export.day_failed': { severity: 'critical', title: 'WORM kopie audit logu selhala' },
  'audit_export.lock_not_enforced': { severity: 'critical', title: 'Audit bucket není neměnný (zámek nedrží) — export zastaven' },
  'audit_export.probe_failed': { severity: 'critical', title: 'Audit bucket nejde ověřit — export zastaven' },
  'sms.ledger_failed': { severity: 'critical', title: 'SMS: neodeslaná SMS zůstala v podkladech pro fakturaci' },
  'users.anonymize_failed': { severity: 'critical', title: 'Anonymizace účtu (GDPR výmaz) selhala' },
  'security.rate_limit_backend_unavailable': { severity: 'critical', title: 'Rate limiting nefunguje (Redis nedostupný)' },
  'auth.superadmin_locked': { severity: 'critical', title: 'Účet superadmina zablokován po neúspěšných pokusech' },
  // The contract end is irreversible — the platform hears it before it happens, in time to stop it
  // (set the obec active again), and after.
  'billing.erasure_imminent': { severity: 'warning', title: 'Obec: za týden se nevratně smažou všechna její data' },
  'billing.erasure_unconfirmed': { severity: 'warning', title: 'Obec je po lhůtě ke smazání a čeká na vaše potvrzení (nebo ji vraťte do Aktivní)' },
  'billing.obec_erased': { severity: 'critical', title: 'Obec byla po konci smlouvy nevratně smazána' },
  'ops.test': { severity: 'warning', title: 'Testovací alert' },
}

/** Lines that are noise one by one and an attack in a burst: [count, window in seconds]. */
const BURSTS: Record<string, { threshold: number; windowSeconds: number; title: string }> = {
  'auth.login_failed': { threshold: 30, windowSeconds: 5 * 60, title: 'Možný útok: mnoho neúspěšných přihlášení' },
  'security.rate_limit_exceeded': { threshold: 100, windowSeconds: 5 * 60, title: 'Možný útok: mnoho požadavků nad limit' },
  'auth.registration_rejected': { threshold: 50, windowSeconds: 10 * 60, title: 'Možný útok: mnoho odmítnutých registrací' },
}

/** Free text (an error message, the line's own message) can quote an address or a query's values —
 * scrubbed (lib/scrub-pii) before it leaves for Discord or a mailbox. */
const pick = (value: unknown, max = 300): string | undefined =>
  typeof value === 'string' && value.trim()
    ? scrubPii(value).slice(0, max)
    : typeof value === 'number'
      ? String(value)
      : undefined

/** What a log line raises, if anything. Pure — the logger calls it for every line it writes. */
export function opsAlertFor(line: LogLine): OpsAlert | { burst: string } | null {
  const { event, fields } = line
  const common = {
    service: line.service,
    environment: line.environment,
    event: event ?? undefined,
    correlationId: pick(fields.correlationId, 100),
  }

  if (fields.severity === 'fatal') {
    return {
      key: `fatal:${event ?? line.message.slice(0, 80)}`,
      severity: 'critical',
      title: `FATAL: ${scrubPii(line.message.replace(/^\[FATAL\]\s*/, '')).slice(0, 200)}`,
      details: { ...common, error: pick(fields.errorMessage) },
    }
  }
  if (!event) return null

  // A job out of attempts is lost unless somebody replays it — one message per job type.
  if (event === 'queue.job_failed') {
    if (fields.exhausted !== true) return null
    const jobType = pick(fields.jobType, 80) ?? 'unknown'
    return {
      key: `job-exhausted:${jobType}`,
      severity: jobType === 'send-email' || jobType === 'send-sms' || jobType === 'event-cancelled' ? 'critical' : 'warning',
      title: `Job ${jobType} vyčerpal všechny pokusy`,
      details: { ...common, jobType, jobId: pick(fields.jobId, 100), error: pick(fields.errorMessage) },
    }
  }

  const immediate = IMMEDIATE[event]
  if (immediate) {
    return {
      key: event,
      severity: immediate.severity,
      title: immediate.title,
      details: {
        ...common,
        message: scrubPii(line.message).slice(0, 300),
        error: pick(fields.errorMessage),
        municipalityId: pick(fields.municipalityId, 20),
      },
    }
  }

  if (BURSTS[event]) return { burst: event }
  return null
}

let redis: Redis | null | undefined
const getRedis = (): Redis | null => {
  if (redis !== undefined) return redis
  try {
    redis = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    redis.on('error', () => undefined)
  } catch {
    redis = null
  }
  return redis
}

const memoryThrottle = new Map<string, number>()
const memoryBursts = new Map<string, { count: number; until: number }>()

/** True when this key may alert now (and claims the slot). */
async function claimSlot(key: string): Promise<boolean> {
  const client = getRedis()
  if (client) {
    try {
      return (await client.set(`lonvita:ops-alert:${key}`, '1', 'EX', THROTTLE_SECONDS, 'NX')) === 'OK'
    } catch {
      // Redis down — the in-memory throttle below is per instance, but better than none.
    }
  }
  const now = Date.now()
  if ((memoryThrottle.get(key) ?? 0) > now) return false
  memoryThrottle.set(key, now + THROTTLE_SECONDS * 1000)
  return true
}

/** Counts one occurrence; returns the count when it has just reached the threshold. */
async function countBurst(event: string): Promise<number | null> {
  const { threshold, windowSeconds } = BURSTS[event]
  const client = getRedis()
  let count: number | null = null
  if (client) {
    try {
      const key = `lonvita:ops-burst:${event}`
      const [[, incr]] = (await client.multi().incr(key).expire(key, windowSeconds, 'NX').exec()) as [
        [Error | null, number],
        unknown,
      ]
      count = incr
    } catch {
      count = null
    }
  }
  if (count === null) {
    const now = Date.now()
    const entry = memoryBursts.get(event)
    const next = entry && entry.until > now ? { count: entry.count + 1, until: entry.until } : { count: 1, until: now + windowSeconds * 1000 }
    memoryBursts.set(event, next)
    count = next.count
  }
  return count === threshold ? count : null
}

const isConfigured = () => Boolean(process.env.OPS_DISCORD_WEBHOOK_URL?.trim() || process.env.OPS_ALERT_EMAILS?.trim())

const detailLines = (details: OpsAlert['details']) =>
  Object.entries(details).filter((entry): entry is [string, string | number | boolean] => entry[1] != null && entry[1] !== '')

async function postDiscord(alert: OpsAlert): Promise<void> {
  const url = process.env.OPS_DISCORD_WEBHOOK_URL?.trim()
  if (!url) return
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      username: 'Lonvita alerts',
      // Nobody gets pinged by text in a field (an error message quoting "@everyone").
      allowed_mentions: { parse: [] },
      content: alert.severity === 'critical' ? '🚨 **Kritický alert**' : '⚠️ Alert',
      embeds: [
        {
          title: alert.title.slice(0, 256),
          color: COLOUR[alert.severity],
          timestamp: new Date().toISOString(),
          fields: detailLines(alert.details)
            .slice(0, 20)
            .map(([name, value]) => ({ name, value: String(value).slice(0, 1_000), inline: String(value).length < 40 })),
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Discord webhook ${res.status}`)
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function sendEmail(alert: OpsAlert): Promise<void> {
  const to = (process.env.OPS_ALERT_EMAILS ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  if (to.length === 0 || !apiKey || !from) return
  const rows = detailLines(alert.details)
    .map(([name, value]) => `<tr><td style="padding:2px 8px;color:#555">${escape(name)}</td><td style="padding:2px 8px"><code>${escape(String(value))}</code></td></tr>`)
    .join('')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      from: `Lonvita alerts <${from}>`,
      to,
      subject: `[${alert.severity === 'critical' ? 'KRITICKÉ' : 'Varování'}] ${alert.title}`.slice(0, 200),
      html: `<h2 style="font-family:sans-serif">${escape(alert.title)}</h2><table style="font-family:sans-serif;font-size:14px">${rows}</table>`,
    }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}`)
}

/** Sends an alert unless the same key went out within the throttle window. Never throws. */
export async function sendOpsAlert(alert: OpsAlert, { force = false }: { force?: boolean } = {}): Promise<boolean> {
  if (!isConfigured()) return false
  try {
    if (!force && !(await claimSlot(alert.key))) return false
    const results = await Promise.allSettled([postDiscord(alert), sendEmail(alert)])
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(JSON.stringify({ level: 'error', message: 'ops_alert.delivery_failed', key: alert.key, error: String(result.reason) }))
      }
    }
    return results.some((result) => result.status === 'fulfilled')
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'ops_alert.failed', key: alert.key, error: String(error) }))
    return false
  }
}

/** The logger's entry point — decides, counts bursts, sends. Never throws. */
export async function raiseOpsAlertFor(line: LogLine): Promise<void> {
  if (!isConfigured()) return
  const decided = opsAlertFor(line)
  if (!decided) return
  if ('burst' in decided) {
    const count = await countBurst(decided.burst)
    if (count === null) return
    const { title, windowSeconds } = BURSTS[decided.burst]
    await sendOpsAlert({
      key: `burst:${decided.burst}`,
      severity: 'critical',
      title,
      details: {
        event: decided.burst,
        count: `${count}+ za ${Math.round(windowSeconds / 60)} min`,
        service: line.service,
        environment: line.environment,
        hint: 'Detail v superadmin → Audit log / security events',
      },
    })
    return
  }
  await sendOpsAlert(decided)
}
