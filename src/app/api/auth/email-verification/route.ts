import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { checkEmailCode, markEmailVerified, needsEmailVerification } from '@/lib/auth/email-verification'
import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/**
 * The e-mail code step of onboarding (lib/auth/email-verification), for the signed-in account.
 *
 * GET  → `{ needed, email }` — whether onboarding opens with the code step.
 * POST `{ code }` → proves the address; `{ ok: true }` or a 400 saying why not.
 * POST /api/auth/email-verification/resend → a fresh code.
 */

/** On top of the per-code cap (EMAIL_CODE_MAX_ATTEMPTS): one account can't keep asking for new
 * codes and guessing each one. Five codes × five attempts an hour is far from a million. */
const VERIFY_LIMIT = { max: 30, windowSeconds: 60 * 60 }

const MESSAGES = {
  invalid: 'Kód nesouhlasí. Zkontrolujte ho a zkuste to znovu.',
  expired: 'Kód vypršel nebo už byl použit. Pošlete si nový.',
  locked: 'Příliš mnoho chybných pokusů. Pošlete si nový kód.',
} as const

export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!needsEmailVerification(user)) {
    return NextResponse.json({ needed: false, email: user.email, codeSentAt: null })
  }
  // Only finishing onboarding asks for the code (Profiles hook), so an account past it — one from
  // before the code existed — never gets the screen.
  const [profiles, account] = await Promise.all([
    payload.find({
      collection: 'profiles',
      where: { user: { equals: user.id } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    }),
    payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true }),
  ])
  return NextResponse.json({
    needed: profiles.docs[0]?.onboardingCompleted !== true,
    email: user.email,
    // null = no code ever left (an older account, or the e-mail failed) — the screen offers one at once.
    codeSentAt: account.emailCodeSentAt ?? null,
  })
}

export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!needsEmailVerification(user)) {
    return NextResponse.json({ ok: true })
  }

  const correlationId = correlationIdFromHeaders(request.headers)
  const limit = await consumeRateLimit({
    namespace: 'email-verification:verify:user',
    identifier: String(user.id),
    ...VERIFY_LIMIT,
    failureMode: 'deny',
  })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Příliš mnoho pokusů. Zkuste to znovu později.', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown }

  let result
  try {
    result = await checkEmailCode(user.id, body.code)
  } catch (error) {
    logger.error('Email verification check failed', {
      event: 'auth.email_verification_check_failed',
      userId: user.id,
      ...serializeError(error),
      correlationId,
    })
    return NextResponse.json({ error: 'Ověření se teď nepodařilo. Zkuste to za chvíli.' }, { status: 503 })
  }

  if (result !== 'ok') {
    logger.info('Email verification rejected', {
      event: 'auth.email_verification_rejected',
      userId: user.id,
      reason: result,
      correlationId,
    })
    return NextResponse.json({ error: MESSAGES[result], reason: result }, { status: 400 })
  }

  await markEmailVerified(payload, user.id)
  logger.audit('Email verified', {
    event: 'auth.email_verified',
    userId: user.id,
    userEmail: user.email,
    method: 'code',
    correlationId,
  })
  return NextResponse.json({ ok: true })
}
