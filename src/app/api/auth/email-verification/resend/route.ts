import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { needsEmailVerification, sendEmailVerificationCode } from '@/lib/auth/email-verification'
import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { consumeRateLimit, getClientIp, type RateLimitResult } from '@/lib/security/rate-limit'

/**
 * "Poslat nový kód" on onboarding's code step. Only to the signed-in account's own address, so it
 * can't be aimed at anybody else's inbox; the limits keep it from flooding that one. Every limit
 * refuses when Redis is down — the code lives there anyway.
 */
const LIMITS = [
  { namespace: 'email-verification:resend:cooldown', max: 1, windowSeconds: 60, by: 'user' },
  { namespace: 'email-verification:resend:user', max: 5, windowSeconds: 60 * 60, by: 'user' },
  { namespace: 'email-verification:resend:ip', max: 20, windowSeconds: 60 * 60, by: 'ip' },
] as const

export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!needsEmailVerification(user)) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  const ip = getClientIp(request.headers)
  const results: RateLimitResult[] = []
  // In order, stopping at the first refusal: a request turned away by the cooldown must not
  // also use up one of the hour's five.
  for (const { namespace, max, windowSeconds, by } of LIMITS) {
    const result = await consumeRateLimit({
      namespace,
      identifier: by === 'user' ? String(user.id) : ip,
      max,
      windowSeconds,
      failureMode: 'deny',
    })
    results.push(result)
    if (!result.allowed) break
  }
  const blocked = results.find((result) => !result.allowed)
  if (blocked) {
    const message =
      blocked.retryAfter <= 60
        ? `Nový kód si můžete poslat za ${blocked.retryAfter} s.`
        : 'Příliš mnoho žádostí o kód. Zkuste to znovu později.'
    return NextResponse.json(
      { error: message, retryAfter: blocked.retryAfter },
      { status: 429, headers: { 'Retry-After': String(blocked.retryAfter) } },
    )
  }

  const correlationId = correlationIdFromHeaders(request.headers)
  try {
    await sendEmailVerificationCode(payload, user)
  } catch (error) {
    logger.error('Email verification code not sent', {
      event: 'auth.email_verification_send_failed',
      userId: user.id,
      stage: 'resend',
      ...serializeError(error),
      correlationId,
    })
    return NextResponse.json({ error: 'E-mail se nepodařilo odeslat. Zkuste to za chvíli.' }, { status: 502 })
  }

  logger.info('Email verification code sent', {
    event: 'auth.email_verification_sent',
    userId: user.id,
    stage: 'resend',
    correlationId,
  })
  return NextResponse.json({ ok: true })
}
