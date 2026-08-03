import { NextResponse } from 'next/server'

import { forgotPasswordAction } from '@/lib/actions/auth/forgot-password'

// HTTP wrapper around forgotPasswordAction — the web/ SPA is a separate app and can't
// call a Next.js server action directly, only a real HTTP endpoint.
export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string }

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  try {
    await forgotPasswordAction({ email })
    return NextResponse.json({ ok: true })
  } catch {
    // Don't leak whether the email exists — Auth0's own endpoint already behaves this way.
    return NextResponse.json({ ok: true })
  }
}
