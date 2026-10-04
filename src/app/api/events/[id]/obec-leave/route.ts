import { NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { eventOrganizerIds, obecRole } from '@/collections/Events'
import { municipalityOrganizationIds } from '@/collections/Organizations'
import {
  escapeHtml,
  getMunicipalityAdminUserIds,
  sendNotificationToMany,
} from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { hasEventEnded } from '@/lib/eventEnded'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * The obec stops co-organizing an event — its own decision, no consent from the event's creator or
 * the other spolupořadatelé needed. For good: Events resolveOrganizations stamps `obecLeftAt`, and
 * from then on the obec can't be put back on the event (nor invited, CoOrganizingRequests). The
 * organizers get the event back to edit (Events lockedEventIds) and hear about it.
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
  if (!(await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)) {
    return NextResponse.json(
      { error: 'Spolupořádání za obec ukončí jen admin obce.' },
      { status: 403 },
    )
  }
  if (hasEventEnded(event.dateTime, event.endDateTime)) {
    return NextResponse.json({ error: 'Akce už proběhla — upravit ji nejde.' }, { status: 409 })
  }
  const req = await createLocalReq({ user }, payload)
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
        message: `${obec} ukončila spolupořádání akce „${event.title}“. Akci teď zase upravujete a spravujete sami.`,
        email: {
          subject: `Obec akci už nespolupořádá: ${event.title}`,
          body:
            `<p>${escapeHtml(obec)} ukončila spolupořádání akce <strong>${title}</strong>. Akci teď zase upravujete a spravujete sami.</p>` +
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
    action: 'events.obec-left',
    actor: user.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(municipalityId) || null,
    metadata: { organization: obecOrganizationId ?? null },
  })

  return NextResponse.json({ left: true })
}
