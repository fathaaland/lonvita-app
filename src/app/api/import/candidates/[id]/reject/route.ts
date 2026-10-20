import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { rejectCandidate } from '@/lib/import/approve'
import { decisionErrorResponse } from '@/lib/import/routes'

/**
 * The obec's admin sets an imported event aside — it won't come back on the next pass over its source.
 *
 * POST /api/import/candidates/:id/reject → { status: 'rejected' }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await rejectCandidate(payload, user, id)
    return NextResponse.json({ status: 'rejected' })
  } catch (error) {
    return decisionErrorResponse(error, 'import.reject_failed', { candidateId: id })
  }
}
