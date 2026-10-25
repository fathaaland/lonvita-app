import { NextResponse } from 'next/server'
import {
  APIError,
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
} from 'payload'

import config from '@payload-config'
import {
  escapeHtml,
  getEventTeamUserIds,
  sendNotificationToMany,
} from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { removeOrganizerFromEvent } from '@/collections/shared/removeOrganizer'
import { runsByRegionRules } from '@/collections/Events'
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { hasEventEnded } from '@/lib/eventEnded'
import { relationId } from '@/lib/relations'

/**
 * A spolupořadatel's organization stops co-organizing an event run by the mikroregion's rules
 * (Events runsByRegionRules) — on its own, up to the cancellation cut-off before the start, nobody's consent needed; the event goes on without it and its team
 * hears about it. It may be invited again later. Not the pořadatel: someone has to keep the event, so
 * they still go through a deletion request (EventDeletionRequests). Outside a mikroregion a
 * spolupořadatel leaves only through a deletion request too.
 *
 * POST /api/events/:id/leave → { left: true }
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
  const uid = String(user.id)
  if (relationId(event.organizer) === uid) {
    return NextResponse.json(
      {
        error:
          'Akci pořádáte vy — opustit ji nejde. Požádejte o její smazání, ostatní ji pak můžou převzít.',
      },
      { status: 409 },
    )
  }
  if (!(event.coOrganizers ?? []).map(relationId).includes(uid)) {
    return NextResponse.json({ error: 'Tuhle akci nespolupořádáte.' }, { status: 403 })
  }
  if (hasEventEnded(event.dateTime, event.endDateTime)) {
    return NextResponse.json({ error: 'Akce už proběhla — upravit ji nejde.' }, { status: 409 })
  }
  // Leaving it to the others the last hours before the start would leave them without a partner
  // they counted on — the same cut-off as cancelling the event.
  if (!canCancelEvent(event.dateTime)) {
    return NextResponse.json(
      { error: `Spolupořádání jde ukončit nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před začátkem akce.` },
      { status: 409 },
    )
  }
  const municipalityId = relationId(event.municipality)
  const req = await createLocalReq({ user }, payload)
  if (!(await runsByRegionRules(req, event))) {
    return NextResponse.json(
      { error: 'Opustit akci sami můžete jen v mikroregionu — jinak požádejte o její smazání.' },
      { status: 403 },
    )
  }

  const shouldCommit = await initTransaction(req)
  let updated
  try {
    updated = await removeOrganizerFromEvent(req, event, uid, null)
    if (shouldCommit) await commitTransaction(req)
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    if (error instanceof APIError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }

  const profile = await payload.find({
    collection: 'profiles',
    where: { user: { equals: uid } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const who = profile.docs[0]?.fullName || 'Spolupořadatel'
  const link = `/akce/${event.id}`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  await sendNotificationToMany(
    payload,
    await getEventTeamUserIds(payload, updated, { exclude: [uid] }),
    {
      title: 'Spolupořadatel akci opustil',
      link,
      message: `${who} ukončil(a) spolupořádání akce „${event.title}“. Akce pokračuje bez něj/ní.`,
      email: {
        subject: `Spolupořadatel akci opustil: ${event.title}`,
        body:
          `<p>${escapeHtml(who)} ukončil(a) spolupořádání akce <strong>${escapeHtml(event.title)}</strong>. Akce pokračuje bez něj/ní.</p>` +
          `<p><a href="${appUrl}${link}">Zobrazit akci</a></p>`,
      },
    },
  )
  writeAuditLog(payload, {
    source: request,
    action: 'events.co-organizer-left',
    actor: user.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(municipalityId) || null,
    metadata: {},
  })
  return NextResponse.json({ left: true })
}
