import { NextResponse } from 'next/server'

import { forgotPasswordAction } from '@/lib/actions/auth/forgot-password'
import { getAppUrl } from '@/lib/auth/app-url'

// HTTP wrapper around forgotPasswordAction — the web/ SPA is a separate app and can't
// call a Next.js server action directly, only a real HTTP endpoint.
export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string }

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  // Never leaks whether the e-mail exists — the action itself always resolves.
  await forgotPasswordAction({ email, appUrl: getAppUrl(request), requestHeaders: request.headers })
  return NextResponse.json({ ok: true })
}
