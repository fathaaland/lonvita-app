import { NextResponse } from 'next/server'
import { createLocalReq, getPayload, type Where } from 'payload'

import config from '@payload-config'
import { mayEditEvent } from '@/collections/Events'
import { notDeleted } from '@/collections/shared/softDelete'
import { regionMunicipalityIds } from '@/lib/microregions'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

const ORGANIZING_ROLES = ['municipality_admin', 'organizer'] as const

/**
 * Which organizations can be invited to co-organize an event in this obec — from the obec and the
 * other obce of its mikroregion (lib/microregions): the event's obec's own one first, then the
 * neighbouring obce, then the organizers' organizations (the café, the club, a single person's "Vycházky pro
 * seniory") by name, never the requester's own — each with its own photo/logo, set on its
 * "Organizace" page. Each joins only once it accepts (CoOrganizingRequests). An organization
 * whose owner has since lost the organizer role isn't offered. Only someone who organizes in the obec
 * (or a platform admin) may list it — or, with `eventId`, whoever may edit that event and so invite
 * to it (a neighbouring obec or organization from the mikroregion co-organizing it). Mirrors
 * CoOrganizingRequests `prepareRequest`.
 *
 * GET /api/events/co-organizer-candidates?municipalityId=1[&eventId=2]
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const municipalityId = Number(params.get('municipalityId'))
  const eventId = Number(params.get('eventId'))
  if (!municipalityId) {
    return NextResponse.json({ error: 'Chybí obec.' }, { status: 400 })
  }

  const region = (await regionMunicipalityIds(payload, municipalityId)).map(Number)
  const roles = await payload.find({
    collection: 'user-roles',
    where: {
      and: [{ municipality: { in: region } }, { role: { in: [...ORGANIZING_ROLES] } }],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const userIdOf = (r: (typeof roles.docs)[number]) => (typeof r.user === 'object' ? r.user.id : r.user)

  const municipalityOf = (r: (typeof roles.docs)[number]) =>
    typeof r.municipality === 'object' ? r.municipality.id : r.municipality
  // Someone organizing in the event's own obec lists its candidates — or whoever may edit the event.
  const editsEvent = async () => {
    if (!eventId) return false
    const event = await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }).catch(() => null)
    if (!event || Number(typeof event.municipality === 'object' ? event.municipality.id : event.municipality) !== municipalityId) {
      return false
    }
    return mayEditEvent(await createLocalReq({ user: actor }, payload), actor, event)
  }
  if (
    actor.role !== 'admin' &&
    !roles.docs.some((r) => userIdOf(r) === actor.id && municipalityOf(r) === municipalityId) &&
    !(await editsEvent())
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // An organization is offered in its own obec, while its owner organizes there.
  const offered: Where[] = [{ type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }]
  for (const id of region) {
    const owners = [
      ...new Set(
        roles.docs
          .filter((r) => r.role === 'organizer' && municipalityOf(r) === id)
          .map(userIdOf)
          .filter((userId) => userId !== actor.id),
      ),
    ]
    if (owners.length > 0) offered.push({ and: [{ municipality: { equals: id } }, { owner: { in: owners } }] })
  }

  const organizations = await payload.find({
    collection: 'organizations',
    where: { and: [{ municipality: { in: region } }, { or: offered }, notDeleted] },
    sort: 'name',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const municipalityIdOf = (o: (typeof organizations.docs)[number]) =>
    typeof o.municipality === 'object' ? o.municipality.id : o.municipality
  const docs = organizations.docs.map((o) => ({
    id: String(o.id),
    municipality_id: String(municipalityIdOf(o)),
    name: o.name,
    type: o.type,
    owner_id: o.owner ? String(typeof o.owner === 'object' ? o.owner.id : o.owner) : null,
    avatar_url: o.avatarUrl ?? null,
  }))
  // The event's own obec first — the one every pořadatel can ask — then the neighbouring obce, then
  // the organizations (by name, as sorted).
  const rank = (d: (typeof docs)[number]) =>
    d.type === MUNICIPALITY_ORGANIZATION_TYPE ? (d.municipality_id === String(municipalityId) ? 0 : 1) : 2
  docs.sort((a, b) => rank(a) - rank(b))

  return NextResponse.json({ docs })
}
