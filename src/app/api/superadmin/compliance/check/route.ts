import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { logger, serializeError } from '@/lib/logger'
import { enqueueComplianceCheck } from '@/lib/queue/queues'

/**
 * "Zkontrolovat teď" — the nightly check of the register of law (worker compliance-check) at once:
 * e-Sbírka for every watched regulation, and reviews come due. Platform admins only.
 *
 * POST /api/superadmin/compliance/check
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await enqueueComplianceCheck()
    writeAuditLog(payload, {
      action: 'legal-requirements.check-requested',
      actor: Number(user.id),
      targetCollection: 'legal-requirements',
      targetId: 'all',
      source: request,
    })
    return NextResponse.json({ queued: true })
  } catch (error) {
    logger.error('Compliance check not queued', { event: 'compliance.enqueue_failed', ...serializeError(error) })
    return NextResponse.json({ error: 'Kontrolu se nepodařilo spustit.' }, { status: 500 })
  }
}
