import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { sendOpsAlert } from '@/lib/alerts/ops'
import { logger } from '@/lib/logger'

/** POST — a superadmin checks the alert channel (Discord webhook, OPS_ALERT_EMAILS) end to end. */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const configured = {
    discord: Boolean(process.env.OPS_DISCORD_WEBHOOK_URL?.trim()),
    email: Boolean(process.env.OPS_ALERT_EMAILS?.trim()),
  }
  if (!configured.discord && !configured.email) {
    return NextResponse.json(
      { error: 'Alerty nejsou nastavené: chybí OPS_DISCORD_WEBHOOK_URL i OPS_ALERT_EMAILS.', configured },
      { status: 409 },
    )
  }

  const sent = await sendOpsAlert(
    {
      key: 'ops.test',
      severity: 'warning',
      title: 'Testovací alert z Lonvity',
      details: {
        requestedBy: `user #${user.id}`,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
        note: 'Pokud tohle čteš, kanál funguje.',
      },
    },
    { force: true },
  )
  logger.audit('Ops alert test sent', { event: 'ops.test_sent', userId: user.id, sent })
  return NextResponse.json({ sent, configured }, { status: sent ? 200 : 502 })
}
