import { hasLiveSession, jwtSecretKey } from '@/lib/auth/sessions'

import type { AuthStrategyFunctionArgs } from 'payload'

type AuthenticatedUser = { collection?: string; _strategy?: string; _sid?: string }

const authenticateViaPayloadToken = async ({ headers, payload }: AuthStrategyFunctionArgs) => {
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) return null

  const cookies = new Map<string, string>()
  cookieHeader.split(';').forEach((c) => {
    const [name, ...rest] = c.trim().split('=')
    if (!name) return
    // A malformed escape (%E0%A4%A) in some unrelated cookie must not turn every request into a 500.
    try {
      cookies.set(name, decodeURI(rest.join('=')))
    } catch {
      // not ours to read — skipped
    }
  })

  const tokenCookieName = `${payload.config.cookiePrefix}-token`
  const token = cookies.get(tokenCookieName)
  if (!token) return null

  try {
    const { jwtVerify } = await import('jose')
    const { payload: decoded } = await jwtVerify(token, jwtSecretKey())

    const user = await payload.findByID({
      id: decoded.id as number,
      collection: decoded.collection as 'users',
      overrideAccess: true,
    })

    // A deleted (anonymized) account — a token minted before still verifies, but nobody is behind it.
    if (!user || (user as { anonymizedAt?: string | null }).anonymizedAt) return null
    // Signed out, the password reset, or the session ended otherwise: the token still verifies, but
    // its session is gone (lib/auth/sessions) — the same check Payload's own JWT strategy makes.
    if (!hasLiveSession(user as Parameters<typeof hasLiveSession>[0], decoded.sid)) return null

    const u = user as unknown as AuthenticatedUser
    u.collection = decoded.collection as string
    u._strategy = 'payload-token-jwt'
    u._sid = decoded.sid as string

    return user
  } catch {
    return null
  }
}

export const payloadTokenJwtStrategy = {
  name: 'payload-token-jwt',
  authenticate: async (args: AuthStrategyFunctionArgs) => {
    // The one way in: the payload-token cookie, whether it came from a password login or from
    // the Google callback minting the very same token.
    return { user: await authenticateViaPayloadToken(args) }
  },
}
