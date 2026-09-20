/**
 * Google as a direct OAuth 2.0 / OpenID Connect provider — no broker in between.
 *
 * Flow: /api/auth/google/start sends the browser to Google, Google sends it back to
 * /api/auth/google/callback with a one-time `code`, and the callback trades that code for an
 * access token and reads the profile. Scopes are the OIDC minimum: `openid` for the stable
 * subject id, `email` for the address plus its verification flag, `profile` for the name.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PROFILE_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback'

export type GoogleProfile = {
  /** Google's stable subject id. The only identifier safe to key an account on — an address
   * can be reassigned inside a Workspace domain, `sub` never changes. */
  providerSubject: string
  email: string | null
  /** Google's own verification of the address. Everything that links to an existing account
   * hangs off this being true. */
  emailVerified: boolean
  fullName: string | null
}

export const isGoogleAuthConfigured = (): boolean =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

export const getGoogleCallbackUrl = (appUrl: string): string => `${appUrl.replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`

export const buildGoogleAuthorizeUrl = ({ state, callbackUrl }: { state: string; callbackUrl: string }): string => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the account chooser: on a shared computer (a library, a community centre)
    // silently reusing whichever Google account is already signed in is the wrong default.
    prompt: 'select_account',
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeCodeForAccessToken(code: string, callbackUrl: string): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    // The body can carry the client secret back in an error echo — never let it reach a log.
    throw new Error(`Google token endpoint returned ${response.status}`)
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Google token endpoint returned no access token')
  return data.access_token
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Google userinfo endpoint returned ${response.status}`)

  const raw = (await response.json()) as Record<string, unknown>
  return normalizeGoogleProfile(raw)
}

/** Exported for its own sake: this is the shape everything downstream trusts, so it's worth
 * being able to test what a missing/odd field turns into. */
export function normalizeGoogleProfile(raw: Record<string, unknown>): GoogleProfile {
  const given = typeof raw.given_name === 'string' ? raw.given_name : null
  const family = typeof raw.family_name === 'string' ? raw.family_name : null
  const name = typeof raw.name === 'string' ? raw.name : null

  return {
    providerSubject: String(raw.sub ?? ''),
    email: typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : null,
    // Google sends this as a real boolean, but be strict rather than truthy: the string
    // "false" must not read as verified.
    emailVerified: raw.email_verified === true,
    fullName: name ?? [given, family].filter(Boolean).join(' ') ?? null,
  }
}
