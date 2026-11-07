import { createHash } from 'node:crypto'

import { addSessionToUser } from 'payload/shared'

import type { Payload, PayloadRequest, TypedUser } from 'payload'

/**
 * Sign-in sessions (Payload's `useSessions`, the users' `sessions` array). Every token carries the id
 * of its session (`sid`), and a token is good only while its session is still on the user — so
 * signing out, resetting the password or a platform admin ending someone's sessions takes effect at
 * once, not when the token runs out two hours later. The auth strategy (payload-token-jwt) checks it.
 */

type SessionRow = { id: string; expiresAt: string | Date }
type WithSessions = { id: number | string; sessions?: SessionRow[] | null }

/** Whether the token's session is still on the user and hasn't run out. */
export function hasLiveSession(user: WithSessions, sid: unknown, now = Date.now()): boolean {
  if (typeof sid !== 'string' || !sid) return false
  const session = (user.sessions ?? []).find((s) => s.id === sid)
  return Boolean(session && new Date(session.expiresAt).getTime() > now)
}

/** Opens a session for a sign-in with no password (Google) — the same Payload's login opens. */
export async function openSession(payload: Payload, user: TypedUser): Promise<string | undefined> {
  const collectionConfig = payload.collections.users.config
  const req = { payload, context: {} } as unknown as PayloadRequest
  // addSessionToUser writes the whole user back — read it fresh, sessions included.
  const fresh = (await payload.db.findOne({ collection: 'users', where: { id: { equals: user.id } }, req })) as TypedUser | null
  const { sid } = await addSessionToUser({ collectionConfig, payload, req, user: fresh ?? user })
  return sid
}

/** Ends one session (sign-out). */
export async function endSession(payload: Payload, userId: number | string, sid: string): Promise<void> {
  const user = (await payload.db.findOne({ collection: 'users', where: { id: { equals: userId } } })) as WithSessions | null
  if (!user?.sessions?.some((s) => s.id === sid)) return
  await payload.db.updateOne({
    collection: 'users',
    id: userId,
    data: { sessions: user.sessions.filter((s) => s.id !== sid), updatedAt: null },
    returning: false,
  })
}

/** Ends every session of the user — after a password reset, whoever had the old one is out. */
export async function endAllSessions(payload: Payload, userId: number | string): Promise<void> {
  await payload.db.updateOne({
    collection: 'users',
    id: userId,
    data: { sessions: [], updatedAt: null },
    returning: false,
  })
}

/** Payload's own JWT key: the secret hashed (sha256, first 32 hex characters). */
export const jwtSecretKey = (): Uint8Array =>
  new TextEncoder().encode(createHash('sha256').update(process.env.PAYLOAD_SECRET!).digest('hex').slice(0, 32))
