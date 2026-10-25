import { NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { actingNeighbourObec, eventOrganizerIds, obecRole } from '@/collections/Events'
import { municipalityOrganizationIds } from '@/collections/Organizations'
import {
  escapeHtml,
  getEventTeamUserIds,
  getMunicipalityAdminUserIds,
  sendNotificationToMany,
} from '@/collections/shared/notify'
import { removeObecFromEvent } from '@/collections/shared/removeOrganizer'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { hasEventEnded } from '@/lib/eventEnded'
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { relationId } from '@/lib/relations'

/**
 * The obec stops co-organizing an event — its own decision, no consent from the event's creator or
 * the other spolupořadatelé needed. For good: Events resolveOrganizations stamps `obecLeftAt`, and
 * from then on the obec can't be put back on the event (nor invited, CoOrganizingRequests). The
 * organizers go on running it without the obec and hear about it.
 * A neighbouring obec from the mikroregion co-organizing the event (Events neighbourObceOf) steps
 * off the same way, on its own — but not for good: like any organization, it may be invited again.
 *
 * POST /api/events/:id/obec-leave → { left: true }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const event = await payload
    .findByID({ collection: 'events', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') {
    return NextResponse.json({ error: 'Akce neexistuje nebo už byla zrušena.' }, { status: 404 })
  }
  const municipalityId = relationId(event.municipality)!
  const req = await createLocalReq({ user }, payload)
  const ownObec = (await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)
  const neighbourId = ownObec ? null : await actingNeighbourObec(req, user, event)
  if (!ownObec && !neighbourId) {
    return NextResponse.json(
      { error: 'Spolupořádání za obec ukončí jen admin obce.' },
      { status: 403 },
    )
  }
  if (hasEventEnded(event.dateTime, event.endDateTime)) {
    return NextResponse.json({ error: 'Akce už proběhla — upravit ji nejde.' }, { status: 409 })
  }
  if (neighbourId) {
    // Like any spolupořadatel, a neighbouring obec leaves no later than the cancellation cut-off.
    if (!canCancelEvent(event.dateTime)) {
      return NextResponse.json(
        { error: `Spolupořádání jde ukončit nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před začátkem akce.` },
        { status: 409 },
      )
    }
    return leaveAsNeighbour(request, req, event, neighbourId)
  }
  if (!(await obecRole(req, event)).coOrganizes) {
    return NextResponse.json({ error: 'Obec tuhle akci nespolupořádá.' }, { status: 409 })
  }

  const obecOrganizationId = (await municipalityOrganizationIds(req, [municipalityId])).get(
    municipalityId,
  )
  const updated = await payload.update({
    collection: 'events',
    id: event.id,
    data: {
      coOrganizations: (event.coOrganizations ?? [])
        .map(relationId)
        .filter((o) => o !== obecOrganizationId)
        .map(Number),
    },
    depth: 0,
    user,
    overrideAccess: true,
    // The obec's own decision — announced below, not as "the obec edited your event".
    context: { coOrganizerConsent: true },
  })

  const municipality = await payload
    .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
    .catch(() => null)
  const obec = municipality ? `Obec ${municipality.name}` : 'Obec'
  const link = `/akce/${event.id}`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const title = escapeHtml(event.title)
  const obecAdminIds = (await getMunicipalityAdminUserIds(payload, municipalityId)).map(String)

  await Promise.all([
    sendNotificationToMany(
      payload,
      eventOrganizerIds(updated).filter((uid) => !obecAdminIds.includes(uid)),
      {
        title: 'Obec akci už nespolupořádá',
        link,
        message: `${obec} ukončila spolupořádání akce „${event.title}“. Akci pořádáte dál bez obce.`,
        email: {
          subject: `Obec akci už nespolupořádá: ${event.title}`,
          body:
            `<p>${escapeHtml(obec)} ukončila spolupořádání akce <strong>${title}</strong>. Akci pořádáte dál bez obce.</p>` +
            `<p><a href="${appUrl}${link}">Zobrazit akci</a></p>`,
        },
      },
    ),
    sendNotificationToMany(
      payload,
      obecAdminIds.filter((uid) => uid !== String(user.id)),
      {
        title: 'Obec akci už nespolupořádá',
        link,
        message: `Spolupořádání akce „${event.title}“ za obec ukončil jiný admin obce. Obec se k akci už vrátit nemůže.`,
      },
    ),
  ])
  writeAuditLog(payload, {
    source: request,
    action: 'events.obec-left',
    actor: user.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(municipalityId) || null,
    metadata: { organization: obecOrganizationId ?? null },
  })

  return NextResponse.json({ left: true })
}

/** A neighbouring obec steps off the event — the pořadatel and the rest of the team hear it, and so
 * do the obec's other admins. It may be invited again. */
async function leaveAsNeighbour(
  request: Request,
  req: Awaited<ReturnType<typeof createLocalReq>>,
  event: Parameters<typeof removeObecFromEvent>[1] & { title: string },
  neighbourId: string,
) {
  const { payload, user } = req
  const updated = await removeObecFromEvent(req, event, neighbourId)
  const municipality = await payload
    .findByID({ collection: 'municipalities', id: neighbourId, depth: 0, overrideAccess: true })
    .catch(() => null)
  const obec = municipality ? `Obec ${municipality.name}` : 'Obec'
  const link = `/akce/${event.id}`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const obecAdminIds = (await getMunicipalityAdminUserIds(payload, neighbourId)).map(String)

  await Promise.all([
    sendNotificationToMany(payload, await getEventTeamUserIds(payload, updated, { exclude: [user!.id, ...obecAdminIds] }), {
      title: 'Obec akci už nespolupořádá',
      link,
      message: `${obec} ukončila spolupořádání akce „${event.title}“. Akci pořádáte dál bez ní.`,
      email: {
        subject: `Obec akci už nespolupořádá: ${event.title}`,
        body:
          `<p>${escapeHtml(obec)} ukončila spolupořádání akce <strong>${escapeHtml(event.title)}</strong>. Akci pořádáte dál bez ní.</p>` +
          `<p><a href="${appUrl}${link}">Zobrazit akci</a></p>`,
      },
    }),
    sendNotificationToMany(payload, obecAdminIds.filter((uid) => uid !== String(user!.id)), {
      title: 'Obec akci už nespolupořádá',
      link,
      message: `Spolupořádání akce „${event.title}“ za obec ukončil jiný admin obce.`,
    }),
  ])
  writeAuditLog(payload, {
    source: request,
    action: 'events.obec-left',
    actor: user!.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(neighbourId) || null,
    metadata: { neighbour: true },
  })
  return NextResponse.json({ left: true })
}
