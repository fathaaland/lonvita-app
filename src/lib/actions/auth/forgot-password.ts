'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

import { enqueueEmail } from '@/lib/queue/queues'
import { forgotPasswordInputSchema } from '@/lib/auth/password-reset-schema'
import { enforcePasswordResetRateLimit } from '@/lib/security/rate-limit'

type ForgotPasswordInput = {
  email: string
  appUrl: string
  requestHeaders: { get: (name: string) => string | null }
}

const buildResetPasswordEmailHtml = (resetUrl: string): string => `
  <p>Dostali jsme žádost o obnovení hesla k vašemu účtu na Lonvitě.</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#5B3A8E;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Nastavit nové heslo</a></p>
  <p>Nebo otevřete tento odkaz: <a href="${resetUrl}">${resetUrl}</a></p>
  <p style="color:#666;font-size:13px;">Odkaz je platný 1 hodinu. Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat — vaše heslo zůstane beze změny.</p>
`

/** Always resolves (never leaks whether the e-mail exists) — the caller shows the same
 * "check your inbox" message regardless. Sends via the BullMQ email queue (Resend). */
export async function forgotPasswordAction({ email, appUrl, requestHeaders }: ForgotPasswordInput): Promise<void> {
  const parsed = forgotPasswordInputSchema.safeParse({ email })
  if (!parsed.success) return

  const rateLimit = await enforcePasswordResetRateLimit({
    operation: 'forgot-password',
    requestHeaders,
    email: parsed.data.email,
  })
  if (!rateLimit.allowed) return

  const payload = await getPayload({ config })

  let token: string | null = null
  try {
    token = await payload.forgotPassword({
      collection: 'users',
      overrideAccess: true,
      disableEmail: true,
      data: { email: parsed.data.email },
    })
  } catch {
    return
  }
  if (!token) return

  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`

  await enqueueEmail({
    to: parsed.data.email,
    subject: 'Obnovení hesla — Lonvita',
    body: buildResetPasswordEmailHtml(resetUrl),
  })
}
