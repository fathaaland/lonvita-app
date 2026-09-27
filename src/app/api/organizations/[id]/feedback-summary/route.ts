import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canAccessOrganization } from '@/lib/exports/access'
import { summarizeOrganizationFeedback } from '@/lib/organization-feedback'

/**
 * What the participants said about the events an organization runs or co-organizes — only in
 * aggregate, so the "Organizace" page can show it to the organization's owner without letting
 * them read anyone's individual feedback (EventFeedback stays readable by its author and the obec's
 * admin). For the owner, an admin of the organization's obec and a platform admin.
 *
 * GET /api/organizations/:id/feedback-summary
 * → { count, avg_satisfaction, avg_felt_welcome, met_someone_new_share, came_alone_share }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessOrganization(payload, user, id)
  if (access === 'missing') return NextResponse.json({ error: 'Organizace neexistuje.' }, { status: 404 })
  if (access === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(await summarizeOrganizationFeedback(payload, id))
}
