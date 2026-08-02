import { createHash } from 'node:crypto'

import type { AuthStrategyFunctionArgs } from 'payload'

type AuthenticatedUser = { collection?: string; _strategy?: string }

const authenticateViaPayloadToken = async ({ headers, payload }: AuthStrategyFunctionArgs) => {
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) return null

  const cookies = new Map<string, string>()
  cookieHeader.split(';').forEach((c) => {
    const [name, ...rest] = c.trim().split('=')
    if (name) cookies.set(name, decodeURI(rest.join('=')))
  })

  const tokenCookieName = `${payload.config.cookiePrefix}-token`
  const token = cookies.get(tokenCookieName)
  if (!token) return null

  try {
    const { jwtVerify } = await import('jose')

    // Payload hashes config.secret with SHA-256, truncated to 32 hex chars.
    const hashedSecret = createHash('sha256')
      .update(process.env.PAYLOAD_SECRET!)
      .digest('hex')
      .slice(0, 32)

    const secretKey = new TextEncoder().encode(hashedSecret)
    const { payload: decoded } = await jwtVerify(token, secretKey)

    const user = await payload.findByID({
      id: decoded.id as number,
      collection: decoded.collection as 'users',
      overrideAccess: true,
    })

    if (!user) return null

    const u = user as unknown as AuthenticatedUser
    u.collection = decoded.collection as string
    u._strategy = 'payload-token-jwt'

    return user
  } catch {
    return null
  }
}

const authenticateViaAuth0Session = async ({ payload }: AuthStrategyFunctionArgs) => {
  try {
    // Dynamic import: the auth0 client pulls in `server-only`, which must stay
    // out of any non-request-scoped bundle (e.g. a future background worker)
    // that also imports this same collection file.
    const { auth0 } = await import('@/lib/auth/auth0/client')
    const session = await auth0.getSession()
    if (!session) return null

    const { docs } = await payload.find({
      collection: 'auth-identities',
      where: { providerSubject: { equals: session.user.sub } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })

    const userId = docs[0]?.user
    if (typeof userId !== 'number') return null

    const user = await payload.findByID({
      id: userId,
      collection: 'users',
      overrideAccess: true,
    })

    if (!user) return null

    const u = user as unknown as AuthenticatedUser
    u.collection = 'users'
    u._strategy = 'auth0-session'

    return user
  } catch {
    // Also thrown outside a Next.js request scope (scripts, tests).
    return null
  }
}

export const payloadTokenJwtStrategy = {
  name: 'payload-token-jwt',
  authenticate: async (args: AuthStrategyFunctionArgs) => {
    const user = (await authenticateViaPayloadToken(args)) ?? (await authenticateViaAuth0Session(args))

    return { user }
  },
}
