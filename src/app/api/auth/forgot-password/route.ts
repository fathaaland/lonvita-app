import { NextResponse } from 'next/server'

import { forgotPasswordAction } from '@/lib/actions/auth/forgot-password'
import { getAppUrl } from '@/lib/auth/app-url'
import { getClientIp } from '@/lib/security/rate-limit'
import { TURNSTILE_REQUIRED_MESSAGE, verifyTurnstile } from '@/lib/security/turnstile'

// HTTP wrapper around forgotPasswordAction — the web/ SPA is a separate app and can't
// call a Next.js server action directly, only a real HTTP endpoint.
export async function POST(request: Request) {
  const { email, turnstileToken } = (await request.json().catch(() => ({}))) as {
    email?: string
    turnstileToken?: string
  }

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }
  // The token comes from the sign-in form's widget (the "Zapomněli jste heslo?" link sits on it).
  // Each request sends an e-mail to whatever address it names — without this, a script could
  // flood anyone's inbox from us (the rate limit is per sender IP and per address, not per botnet).
  if ((await verifyTurnstile(turnstileToken, getClientIp(request.headers), 'login')) === 'failed') {
    return NextResponse.json({ error: TURNSTILE_REQUIRED_MESSAGE }, { status: 428 })
  }

  // Never leaks whether the e-mail exists — the action itself always resolves.
  await forgotPasswordAction({ email, appUrl: getAppUrl(request), requestHeaders: request.headers })
  return NextResponse.json({ ok: true })
}
