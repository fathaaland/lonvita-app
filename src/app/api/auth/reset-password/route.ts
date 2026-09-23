import { NextResponse } from 'next/server'

import { isResetTokenValid, resetPasswordAction } from '@/lib/actions/auth/reset-password'

/** Lets /reset-password turn away a spent or expired link as soon as it opens. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const valid = token ? await isResetTokenValid(token) : false
  return NextResponse.json({ valid })
}

export async function POST(request: Request) {
  const { token, password } = (await request.json()) as { token?: string; password?: string }

  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password are required.' }, { status: 400 })
  }

  const result = await resetPasswordAction({ token, password, requestHeaders: request.headers })
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
