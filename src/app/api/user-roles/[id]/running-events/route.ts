import { NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { findRunningEvents } from '@/collections/shared/runningEvents'
import { relationId } from '@/lib/relations'

/**
 * What the organizer still runs in the obec — the obec's admin sees it before revoking their role,
 * which can't go while there's any (UserRoles keepRunningEventsOrganized). For the obec's admins and
 * a platform admin.
 *
 * GET /api/user-roles/:id/running-events → { events: { id, title, date_time, organizes }[] }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await payload.findByID({ collection: 'user-roles', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!role || role.role !== 'organizer') {
    return NextResponse.json({ error: 'Role organizátora neexistuje.' }, { status: 404 })
  }
  const municipalityId = relationId(role.municipality)!
  if (user.role !== 'admin' && !(await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const running = await findRunningEvents(await createLocalReq({}, payload), relationId(role.user)!, municipalityId)
  return NextResponse.json({
    events: running.map((e) => ({ id: String(e.id), title: e.title, date_time: e.dateTime, organizes: e.organizes })),
  })
}
