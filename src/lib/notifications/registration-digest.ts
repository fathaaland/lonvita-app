import { logger, serializeError } from '@/lib/logger'
import { Redis } from 'ioredis'

import { enqueueRegistrationDigest } from '@/lib/queue/queues'
import { queueConnectionOptions } from '@/lib/valkey/client'

/**
 * "Nová přihláška" e-mails to an event's team, batched. The in-app notification still goes out at
 * once; the e-mail waits for the window to close and then lists everyone who signed up in it — so
 * a popular event opening its registration sends its organizer one e-mail every ten minutes, not
 * hundreds (and doesn't eat the Resend rate the cancellations and password resets need).
 *
 * The registrations' hook decides who hears of a registration and how it's described (it knows the
 * context — a seed, an accepted invitation — and the registrant's reliability), and leaves that
 * here in Redis: per window and recipient a list of entries. One job per event and window (its job
 * id dedups the adds) reads them after the window, drops the registrations no longer active and
 * sends each recipient one e-mail.
 */

export const REGISTRATION_DIGEST_WINDOW_MS = 10 * 60_000
/** After the window closes, so the last registrations of it have committed. */
const DIGEST_GRACE_MS = 30_000
/** Long past the job's run, in case the worker was down for a while. */
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60

export type DigestEntry = {
  registrationId: number | string
  /** "Jana Nováková (jana@example.cz)" */
  who: string
  /** Waiting for this recipient's approval — and why, when it's their no-shows. */
  awaiting?: string
}

let redis: Redis | undefined
/** Its own connection with a command timeout — a registration must not hang on Redis. */
const getClient = (): Redis => {
  if (!redis) {
    redis = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    redis.on('error', () => undefined)
  }
  return redis
}

export const windowStartOf = (at: number): number =>
  Math.floor(at / REGISTRATION_DIGEST_WINDOW_MS) * REGISTRATION_DIGEST_WINDOW_MS

const recipientsKey = (eventId: number | string, windowStart: number) =>
  `lonvita:reg-digest:${eventId}:${windowStart}`
const entriesKey = (eventId: number | string, windowStart: number, recipientId: string) =>
  `${recipientsKey(eventId, windowStart)}:${recipientId}`

export const registrationDigestJobId = (eventId: number | string, windowStart: number) =>
  `registration-digest-${eventId}-${windowStart}`

/**
 * Files the entry for each recipient and makes sure the window's job is queued. False when that
 * couldn't be done (Redis down) — the caller then e-mails the old way, one by one.
 */
export async function addToRegistrationDigest(
  eventId: number | string,
  recipientIds: string[],
  entry: DigestEntry,
  now = Date.now(),
): Promise<boolean> {
  if (recipientIds.length === 0) return true
  const windowStart = windowStartOf(now)
  try {
    const client = getClient()
    const multi = client.multi()
    for (const recipientId of recipientIds) {
      const key = entriesKey(eventId, windowStart, recipientId)
      multi.rpush(key, JSON.stringify(entry)).expire(key, KEY_TTL_SECONDS)
    }
    multi.sadd(recipientsKey(eventId, windowStart), ...recipientIds).expire(recipientsKey(eventId, windowStart), KEY_TTL_SECONDS)
    const results = await multi.exec()
    if (!results || results.some(([error]) => error)) throw new Error('Redis rejected the digest entry')

    await enqueueRegistrationDigest(
      { eventId, windowStart },
      {
        jobId: registrationDigestJobId(eventId, windowStart),
        delay: Math.max(0, windowStart + REGISTRATION_DIGEST_WINDOW_MS + DIGEST_GRACE_MS - now),
      },
    )
    return true
  } catch (error) {
    logger.warn('Registration digest unavailable — e-mailing at once', {
      event: 'notifications.registration_digest_unavailable',
      eventId,
      ...serializeError(error),
    })
    return false
  }
}

/** What the window holds, per recipient. */
export async function readRegistrationDigest(
  eventId: number | string,
  windowStart: number,
): Promise<Map<string, DigestEntry[]>> {
  const client = getClient()
  const recipients = await client.smembers(recipientsKey(eventId, windowStart))
  const byRecipient = new Map<string, DigestEntry[]>()
  for (const recipientId of recipients) {
    const raw = await client.lrange(entriesKey(eventId, windowStart, recipientId), 0, -1)
    const entries = raw.flatMap((item) => {
      try {
        return [JSON.parse(item) as DigestEntry]
      } catch {
        return []
      }
    })
    if (entries.length > 0) byRecipient.set(recipientId, entries)
  }
  return byRecipient
}

export async function clearRegistrationDigest(eventId: number | string, windowStart: number, recipientIds: string[]) {
  const client = getClient()
  await client.del(recipientsKey(eventId, windowStart), ...recipientIds.map((id) => entriesKey(eventId, windowStart, id)))
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Listed by name up to this many; the rest as a count. */
const LISTED = 50

const few = (n: number) => n >= 2 && n <= 4

/** The e-mail for one recipient. One registration reads as it always did. */
export function digestEmail(eventTitle: string, entries: DigestEntry[]): { subject: string; body: string } {
  if (entries.length === 1) {
    const [only] = entries
    return {
      subject: `Nová přihláška: ${eventTitle}`,
      body: `<p>${escapeHtml(only.who)} se přihlásil(a) na vaši akci <strong>${escapeHtml(eventTitle)}</strong>.${only.awaiting ? escapeHtml(only.awaiting) : ''}</p>`,
    }
  }
  const listed = entries.slice(0, LISTED)
  const rest = entries.length - listed.length
  const awaiting = entries.filter((e) => e.awaiting).length
  const items = listed
    .map((e) => `<li>${escapeHtml(e.who)}${e.awaiting ? ' — <em>čeká na vaše schválení</em>' : ''}</li>`)
    .join('')
  return {
    subject: `${entries.length} ${few(entries.length) ? 'nové přihlášky' : 'nových přihlášek'}: ${eventTitle}`,
    body:
      `<p>Na vaši akci <strong>${escapeHtml(eventTitle)}</strong> se za posledních ${REGISTRATION_DIGEST_WINDOW_MS / 60_000} minut ${few(entries.length) ? `přihlásili ${entries.length} lidé` : `přihlásilo ${entries.length} lidí`}:</p>` +
      `<ul>${items}</ul>` +
      (rest > 0 ? `<p>…a dalších ${rest}.</p>` : '') +
      (awaiting > 0 ? `<p>${awaiting} z nich čeká na vaše schválení.</p>` : ''),
  }
}
