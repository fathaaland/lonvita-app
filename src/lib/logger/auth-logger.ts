import { logger } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { getClientIp } from '@/lib/security/rate-limit'
import { noteLoginFailure } from '@/lib/security/turnstile'

import type {
  CollectionAfterForgotPasswordHook,
  CollectionAfterLoginHook,
  CollectionAfterLogoutHook,
  PayloadRequest,
} from 'payload'

/**
 * Auth is where an incident starts, so these lines carry more than the CRUD trail does: the
 * source address, so a burst of failures against one account is recognisable, and the e-mail,
 * so "who" does not require a second lookup. Failed logins are not hookable in Payload — they
 * throw, and the global afterError hook in payload.config records them instead.
 */
const authContext = (req: PayloadRequest) => ({
  correlationId: correlationIdFromHeaders(req?.headers),
  ip: req?.headers ? getClientIp(req.headers) : 'unknown',
  userAgent: req?.headers?.get?.('user-agent')?.slice(0, 200) ?? undefined,
})

export const logLoginSuccess: CollectionAfterLoginHook = ({ req, user }) => {
  const account = user as { id?: number | string; email?: string; role?: string }
  logger.audit('Login success', {
    event: 'auth.login_success',
    userId: account?.id,
    userEmail: account?.email,
    userRole: account?.role,
    ...authContext(req),
  })
}

export const logLogout: CollectionAfterLogoutHook = ({ req }) => {
  const account = req?.user as { id?: number | string; email?: string } | undefined
  logger.audit('Logout', {
    event: 'auth.logout',
    userId: account?.id,
    userEmail: account?.email,
    ...authContext(req),
  })
}

export const logForgotPasswordIssued: CollectionAfterForgotPasswordHook = ({ args }) => {
  const email = (args?.data as { email?: string } | undefined)?.email
  logger.audit('Password reset token issued', {
    event: 'auth.forgot_password_token_issued',
    userEmail: email,
    correlationId: correlationIdFromHeaders(args?.req?.headers),
  })
}

/**
 * A wrong password (401) or a locked account (423) on POST /api/users/login — called from the
 * global afterError hook (payload.config), since a failed login throws past every collection hook.
 * Bursts of these page the platform team (lib/alerts/ops); a superadmin's account getting locked
 * pages it at once — that's someone guessing the one password that opens everything.
 */
export async function logLoginFailure(req: PayloadRequest, locked: boolean): Promise<void> {
  const email = (req?.data as { email?: unknown } | undefined)?.email
  const userEmail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 320) : undefined
  const ip = req?.headers ? getClientIp(req.headers) : 'unknown'
  await noteLoginFailure(ip)
  logger.audit(
    locked ? 'Login refused — account locked' : 'Login failed',
    { event: 'auth.login_failed', outcome: 'failure', locked, userEmail, ...authContext(req) },
    'warn',
  )
  if (!userEmail) return
  try {
    const found = await req.payload.find({
      collection: 'users',
      where: { and: [{ email: { equals: userEmail } }, { role: { equals: 'admin' } }] },
      select: { lockUntil: true },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    const admin = found.docs[0] as { id: number; lockUntil?: string | null } | undefined
    if (admin?.lockUntil && new Date(admin.lockUntil).getTime() > Date.now()) {
      logger.audit(
        'Superadmin account locked',
        { event: 'auth.superadmin_locked', outcome: 'failure', userId: admin.id, ...authContext(req) },
        'warn',
      )
    }
  } catch {
    // The failed login itself is logged above; the lookup is only for the alert.
  }
}
