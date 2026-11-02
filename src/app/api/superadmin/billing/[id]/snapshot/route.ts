import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { takeActiveUserSnapshot } from '@/lib/billing/active-users'
import { logger, serializeError } from '@/lib/logger'

/**
 * The superadmin counts the obec's users now and keeps it as this month's snapshot (over the monthly
 * job's) — Balíčky služeb: "Superadmin každý měsíc uloží snímek počtu".
 *
 * POST /api/superadmin/billing/:id/snapshot
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const municipalityId = Number(id)
  if (!Number.isInteger(municipalityId) || municipalityId <= 0) {
    return NextResponse.json({ error: 'Neplatná obec.' }, { status: 400 })
  }

  try {
    const snapshot = await takeActiveUserSnapshot(
      payload,
      municipalityId,
      new Date(),
      Number(user.id),
    )
    writeAuditLog(payload, {
      action: 'active-user-snapshots.take',
      actor: Number(user.id),
      targetCollection: 'municipalities',
      targetId: municipalityId,
      municipality: municipalityId,
      metadata: { month: snapshot.month, activeUsers: snapshot.activeUsers },
      source: request,
    })
    return NextResponse.json(snapshot)
  } catch (error) {
    logger.error('Active user snapshot failed', {
      event: 'billing.snapshot_failed',
      municipalityId,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Snímek se nepodařilo uložit.' }, { status: 500 })
  }
}
