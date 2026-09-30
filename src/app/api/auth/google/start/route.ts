import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'

import { getAppUrl } from '@/lib/auth/app-url'
import {
  buildGoogleAuthorizeUrl,
  getGoogleCallbackUrl,
  isGoogleAuthConfigured,
} from '@/lib/auth/google/provider'
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS, createOAuthState } from '@/lib/auth/google/state'

const PROFILE_PATH = '/profil'

/**
 * Starts the Google sign-in: mints the CSRF state, drops it in a cookie, and hands the browser
 * to Google. `returnTo` rides along inside the cookie rather than in the URL, so it can't be
 * rewritten between here and the callback.
 *
 * `?intent=link` starts the same round trip from the profile instead, to attach Google to the
 * account that is signed in — the state then carries that account's id, and the callback lands
 * back on the profile.
 */
export async function GET(request: Request) {
  const appUrl = getAppUrl(request)

  if (!isGoogleAuthConfigured()) {
    return NextResponse.redirect(new URL('/auth?error=google-unavailable', appUrl))
  }

  const { searchParams } = new URL(request.url)
  let linkUserId: number | undefined
  if (searchParams.get('intent') === 'link') {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })
    if (!user) return NextResponse.redirect(new URL('/auth', appUrl))
    linkUserId = user.id
  }
  const { state, cookieValue } = createOAuthState(
    linkUserId === undefined ? searchParams.get('returnTo') : PROFILE_PATH,
    { linkUserId },
  )

  const response = NextResponse.redirect(
    buildGoogleAuthorizeUrl({ state, callbackUrl: getGoogleCallbackUrl(appUrl) }),
  )

  response.cookies.set(OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax', // Google's redirect back is a top-level GET — 'strict' would drop the cookie.
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/google',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  })

  return response
}
