import { createHmac, randomInt } from 'node:crypto'

import Redis from 'ioredis'
import type { Payload } from 'payload'

import type { User } from '@/payload-types'

/**
 * Proving an e-mail sign-up's address with a 6-digit code — sent on registration, entered as the
 * first step of onboarding. A Google sign-up needs none of this: Google proves the address
 * (link-account refuses an unverified one and stamps `emailVerifiedAt` itself).
 *
 * The code lives only in Redis, as an HMAC (keyed by PAYLOAD_SECRET and bound to the user), for
 * EMAIL_CODE_TTL_SECONDS, and dies after EMAIL_CODE_MAX_ATTEMPTS wrong guesses — a million
 * combinations are only a defence while guessing is capped. Issuing a new code replaces the old.
 */

export const EMAIL_CODE_TTL_SECONDS = 15 * 60
export const EMAIL_CODE_MAX_ATTEMPTS = 5
const EMAIL_CODE_LENGTH = 6

type CodeStore = Pick<Redis, 'eval'>

let redis: CodeStore | null | undefined

const getRedis = (): CodeStore | null => {
  if (redis !== undefined) return redis
  if (process.env.REDIS_URL) {
    const client = new Redis(process.env.REDIS_URL, {
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    })
    client.on('error', () => undefined)
    redis = client
  } else {
    redis = null
  }
  return redis
}

const keyFor = (userId: number | string) => `email-verification:${userId}`

const hashCode = (userId: number | string, code: string): string =>
  createHmac('sha256', process.env.PAYLOAD_SECRET || '')
    .update(`email-verification:${userId}:${code}`)
    .digest('hex')

/** Replace whatever code was there: fresh hash, zero attempts, full TTL — in one step. */
const ISSUE_SCRIPT = `
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'h', ARGV[1], 'a', 0)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`

/**
 * Compare and count in one step, so two parallel guesses can't share one attempt. The hashes are
 * HMACs under a server secret, so comparing them with `==` leaks nothing a caller could steer.
 *  1 = match (code consumed) · 0 = none (expired, used or never sent) · -1 = wrong · -2 = wrong, code gone
 */
const CHECK_SCRIPT = `
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return 0 end
if h == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
local a = redis.call('HINCRBY', KEYS[1], 'a', 1)
if a >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return -2
end
return -1
`

export const generateEmailCode = (): string =>
  String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0')

/** Digits only — "123 456" pasted from the e-mail counts as 123456. */
export const normalizeEmailCode = (input: unknown): string | null => {
  if (typeof input !== 'string') return null
  const code = input.replace(/\s+/g, '')
  return new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`).test(code) ? code : null
}

export async function issueEmailCode(
  userId: number | string,
  store: CodeStore | null = getRedis(),
  code: string = generateEmailCode(),
): Promise<string> {
  if (!store) throw new Error('Email verification store unavailable (REDIS_URL not set).')
  await store.eval(ISSUE_SCRIPT, 1, keyFor(userId), hashCode(userId, code), String(EMAIL_CODE_TTL_SECONDS))
  return code
}

export type EmailCodeCheck = 'ok' | 'invalid' | 'expired' | 'locked'

export async function checkEmailCode(
  userId: number | string,
  input: unknown,
  store: CodeStore | null = getRedis(),
): Promise<EmailCodeCheck> {
  const code = normalizeEmailCode(input)
  // A malformed code isn't a guess at the real one — it doesn't cost an attempt.
  if (!code) return 'invalid'
  if (!store) throw new Error('Email verification store unavailable (REDIS_URL not set).')
  const result = Number(
    await store.eval(CHECK_SCRIPT, 1, keyFor(userId), hashCode(userId, code), String(EMAIL_CODE_MAX_ATTEMPTS)),
  )
  if (result === 1) return 'ok'
  if (result === 0) return 'expired'
  if (result === -2) return 'locked'
  return 'invalid'
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const buildEmailHtml = (code: string): string => `
  <p>Dobrý den,</p>
  <p>pro dokončení registrace na Lonvitě zadejte tento ověřovací kód:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace;margin:24px 0;">${escapeHtml(code)}</p>
  <p style="color:#666;font-size:13px;">Kód platí ${EMAIL_CODE_TTL_SECONDS / 60} minut. Pokud jste se na Lonvitě neregistrovali, tento e-mail můžete ignorovat.</p>
`

/**
 * Mints a code and e-mails it straight from the request, not through the queue: the person is
 * waiting for it on the screen, and a sleeping worker would hold it back. Throws when any step
 * fails — the caller decides whether that's fatal.
 *
 * The e-mail goes out before the code replaces the old one in Redis: when sending fails, the code
 * already in the person's inbox keeps working. `emailCodeSentAt` is stamped only once the e-mail
 * left — onboarding reads it to tell "on its way" from "never sent", and the retention rule only
 * ever removes an account that was actually sent a code.
 */
export async function sendEmailVerificationCode(
  payload: Payload,
  user: Pick<User, 'id' | 'email'>,
  store?: CodeStore | null,
): Promise<void> {
  const codeStore = store === undefined ? getRedis() : store
  if (!codeStore) throw new Error('Email verification store unavailable (REDIS_URL not set).')
  const code = generateEmailCode()
  await payload.sendEmail({
    to: user.email,
    subject: `${code} je váš ověřovací kód — Lonvita`,
    html: buildEmailHtml(code),
  })
  await issueEmailCode(user.id, codeStore, code)
  await payload.update({
    collection: 'users',
    id: user.id,
    data: { emailCodeSentAt: new Date().toISOString() },
    overrideAccess: true,
  })
}

/** Whether the account still has to prove its address. The platform superadmin never does. */
export const needsEmailVerification = (user: Pick<User, 'role' | 'emailVerifiedAt'>): boolean =>
  user.role !== 'admin' && !user.emailVerifiedAt

export async function markEmailVerified(payload: Payload, userId: number): Promise<void> {
  await payload.update({
    collection: 'users',
    id: userId,
    data: { emailVerifiedAt: new Date().toISOString() },
    overrideAccess: true,
  })
}
