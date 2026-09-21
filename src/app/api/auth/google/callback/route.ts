import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAppUrl } from '@/lib/auth/app-url'
import { resolveGoogleUser } from '@/lib/auth/google/link-account'
import {
  exchangeCodeForAccessToken,
  fetchGoogleProfile,
  getGoogleCallbackUrl,
  isGoogleAuthConfigured,
} from '@/lib/auth/google/provider'
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH, verifyOAuthState } from '@/lib/auth/google/state'
import { buildPayloadTokenCookie } from '@/lib/auth/session-cookie'

/** Error codes the /auth page turns into Czech copy — never the raw provider message, which
 * can echo back request details. */
type AuthError = 'google-failed' | 'google-unavailable' | 'google-email-unverified' | 'google-no-email'

const failTo = (appUrl: string, error: AuthError) => {
  const response = NextResponse.redirect(new URL(`/auth?error=${error}`, appUrl))
  clearStateCookie(response)
  return response
}

/** The flow is over either way — don't leave a state cookie lying around to be replayed.
 *
 * Appends a raw header rather than going through `response.cookies`: that API re-serialises the
 * whole Set-Cookie set from its own store, and on a NextResponse whose cookies were never touched
 * the store starts out empty — so it silently dropped the session cookie appended just above,
 * and the Google sign-in landed back on /auth with no session at all. */
function clearStateCookie(response: NextResponse) {
  response.headers.append(
    'Set-Cookie',
    `${OAUTH_STATE_COOKIE}=; Path=${OAUTH_STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`,
  )
}

export async function GET(request: Request) {
  const appUrl = getAppUrl(request)
  if (!isGoogleAuthConfigured()) return failTo(appUrl, 'google-unavailable')

  const { searchParams } = new URL(request.url)

  // Google reports a user who cancelled with ?error=access_denied — that's not a failure worth
  // an error banner, they just changed their mind.
  if (searchParams.get('error')) {
    const response = NextResponse.redirect(new URL('/auth', appUrl))
    clearStateCookie(response)
    return response
  }

  const stateCookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1)

  const verified = verifyOAuthState(searchParams.get('state'), stateCookie)
  if (!verified.valid) return failTo(appUrl, 'google-failed')

  const code = searchParams.get('code')
  if (!code) return failTo(appUrl, 'google-failed')

  const payload = await getPayload({ config })

  try {
    const accessToken = await exchangeCodeForAccessToken(code, getGoogleCallbackUrl(appUrl))
    const profile = await fetchGoogleProfile(accessToken)
    if (!profile.providerSubject) return failTo(appUrl, 'google-failed')

    const result = await resolveGoogleUser(payload, profile)
    if (!result.ok) {
      return failTo(appUrl, result.reason === 'no-email' ? 'google-no-email' : 'google-email-unverified')
    }

    // Someone who hasn't finished onboarding goes there rather than to wherever they were
    // headed — the same rule the password sign-in follows.
    const profiles = await payload.find({
      collection: 'profiles',
      where: { user: { equals: result.user.id } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    const destination = profiles.docs[0]?.onboardingCompleted ? verified.returnTo : '/onboarding'

    const response = NextResponse.redirect(new URL(destination, appUrl))
    response.headers.append('Set-Cookie', await buildPayloadTokenCookie(payload, result.user))
    clearStateCookie(response)
    return response
  } catch (error) {
    payload.logger.error({ err: error }, '[GoogleAuth] Sign-in failed')
    return failTo(appUrl, 'google-failed')
  }
}
