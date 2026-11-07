import { Redis } from 'ioredis'

import { logger, serializeError } from '@/lib/logger'
import { queueConnectionOptions } from '@/lib/valkey/client'

/**
 * Cloudflare Turnstile — the "not a robot" check on sign-up, password reset and (after a few failed
 * attempts from one address) sign-in. Off until TURNSTILE_SECRET_KEY and
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY are both set, so local development and tests need neither.
 *
 * Fails open when Cloudflare itself can't be reached: a Turnstile outage must not lock everybody
 * out of their account — the rate limits (proxy) and the account lockout still stand. An explicit
 * "this token is not valid" from Cloudflare always fails.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const isTurnstileEnabled = (): boolean =>
  Boolean(process.env.TURNSTILE_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim())

export const TURNSTILE_REQUIRED_MESSAGE = 'Potvrďte prosím, že nejste robot, a zkuste to znovu.'

export type TurnstileOutcome = 'passed' | 'failed' | 'unavailable' | 'disabled'

export async function verifyTurnstile(token: unknown, ip?: string, action?: string): Promise<TurnstileOutcome> {
  if (!isTurnstileEnabled()) return 'disabled'
  if (typeof token !== 'string' || !token || token.length > 2048) return 'failed'
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!.trim(), response: token })
    if (ip && ip !== 'unknown') body.set('remoteip', ip)
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`siteverify ${res.status}`)
    const result = (await res.json()) as { success?: boolean; action?: string; 'error-codes'?: string[] }
    // A token minted for another form (the widget's `action`) isn't accepted here.
    if (result.success && (!action || !result.action || result.action === action)) return 'passed'
    logger.warn('Turnstile check failed', {
      event: 'security.turnstile_failed',
      action,
      ip,
      errorCodes: result['error-codes'],
    })
    return 'failed'
  } catch (error) {
    logger.warn('Turnstile unreachable — let through', {
      event: 'security.turnstile_unavailable',
      action,
      ...serializeError(error),
    })
    return 'unavailable'
  }
}

/** Failed sign-ins from one address after which the login form has to pass Turnstile. Below it the
 * Payload admin's own login form (which can't show the widget) keeps working. */
export const LOGIN_FAILURES_BEFORE_CAPTCHA = 3
const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60

let client: Redis | undefined
const getClient = (): Redis => {
  if (!client) {
    client = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    client.on('error', () => undefined)
  }
  return client
}

const failuresKey = (ip: string) => `lonvita:login-failures:${ip}`

export async function noteLoginFailure(ip: string): Promise<void> {
  if (!isTurnstileEnabled() || ip === 'unknown') return
  try {
    await getClient().multi().incr(failuresKey(ip)).expire(failuresKey(ip), LOGIN_FAILURE_WINDOW_SECONDS).exec()
  } catch {
    // Without Redis the login captcha simply doesn't kick in; the rate limit is fail-open too.
  }
}

export async function loginFailuresOf(ip: string): Promise<number> {
  if (ip === 'unknown') return 0
  try {
    return Number(await getClient().get(failuresKey(ip))) || 0
  } catch {
    return 0
  }
}
