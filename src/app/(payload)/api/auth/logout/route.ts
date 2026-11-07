import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'

import { getAppUrl } from '@/lib/auth/app-url'
import { getSafeRedirectPath } from '@/lib/auth/redirect'
import { endSession, jwtSecretKey } from '@/lib/auth/sessions'
import { logger, serializeError } from '@/lib/logger'

/** The session the cookie's token belongs to, ended — best effort: signing out never fails. An expired
 * token's session has run out on its own. */
async function endSessionOf(request: Request): Promise<void> {
  const token = /(?:^|;\s*)payload-token=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1]
  if (!token) return
  try {
    const { payload: decoded } = await jwtVerify(token, jwtSecretKey())
    if (typeof decoded.sid !== 'string' || decoded.id === undefined) return
    await endSession(await getPayload({ config }), decoded.id as number, decoded.sid)
  } catch (error) {
    logger.debug('Sign-out: no session to end', { event: 'auth.logout_session_not_ended', ...serializeError(error) })
  }
}

// Overrides Payload's own auto-generated logout endpoint at this path. The payload-token cookie —
// whether it was minted by a password login or by the Google callback — is dropped, and its session
// ended on the server (lib/auth/sessions): a copy of the token taken before is no good after.
//
// Also where an expired session is sent (integrations/payload/client.ts): `redirect` is the page
// to return to after signing in again, `reason=expired` lets the sign-in page say why it's there.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const signInUrl = new URL('/auth', getAppUrl(request))
  const redirect = getSafeRedirectPath(searchParams.get('redirect'), '')
  if (redirect) signInUrl.searchParams.set('redirect', redirect)
  if (searchParams.get('reason') === 'expired') signInUrl.searchParams.set('reason', 'expired')

  await endSessionOf(request)

  const response = NextResponse.redirect(signInUrl)
  response.cookies.delete('payload-token')
  return response
}
