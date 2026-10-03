import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { loadOrganizersDirectory, organizesIn } from '@/lib/organizers-directory'

/**
 * "Organizátoři v mém městě" — every organization organizing in the obec, each with its own
 * description and the headline numbers of its Organizace page (no ratings). For the obec's admins
 * and organizers (an applicant only once the obec approves them) and a platform admin.
 *
 * GET /api/municipalities/:id/organizers → { docs: OrganizerProfile[] }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!Number(id)) return NextResponse.json({ error: 'Obec neexistuje.' }, { status: 404 })
  if (!(await organizesIn(payload, user, id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ docs: await loadOrganizersDirectory(payload, id, user.id) })
}
