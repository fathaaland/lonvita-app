import { NextResponse } from 'next/server'

import { getSafeRedirectPath } from '@/lib/auth/redirect'

export const AUTH_EXPIRED_REASON = 'session-expired'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const redirectPath = getSafeRedirectPath(searchParams.get('redirect'), '/login')
  const error = searchParams.get('error')

  const loginUrl = new URL('/login', request.url)
  if (redirectPath !== '/login') {
    loginUrl.searchParams.set('reason', AUTH_EXPIRED_REASON)
  }
  if (error) {
    loginUrl.searchParams.set('error', error)
  }

  const response = NextResponse.redirect(loginUrl)

  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  for (const { name } of cookieStore.getAll()) {
    if (/^__session(__\d+)?$/.test(name)) {
      response.cookies.delete(name)
    }
  }

  return response
}
