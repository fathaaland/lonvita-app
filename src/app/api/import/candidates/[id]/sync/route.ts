import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { decisionErrorResponse } from '@/lib/import/routes'
import { applySourceChanges, dismissSyncNotices } from '@/lib/import/sync'

/**
 * What the owner decides about a taken-over event its source changed (lib/import/sync): take the
 * source's version onto the event ("Převzít z webu"), or set the notices aside ("Beru na vědomí").
 *
 * POST /api/import/candidates/:id/sync  { action: 'apply' | 'dismiss' } → { status }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  const action = body?.action
  if (action !== 'apply' && action !== 'dismiss')
    return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400 })

  try {
    if (action === 'apply') await applySourceChanges(payload, user, id, request)
    else await dismissSyncNotices(payload, user, id)
    return NextResponse.json({ status: action === 'apply' ? 'applied' : 'dismissed' })
  } catch (error) {
    return decisionErrorResponse(error, 'import.sync_decision_failed', { candidateId: id, action })
  }
}
