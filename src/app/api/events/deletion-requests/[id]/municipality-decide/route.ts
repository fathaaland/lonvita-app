import { NextResponse } from 'next/server'
import { APIError, commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'

import config from '@payload-config'
import { eventOrganizerIds } from '@/collections/Events'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { getEventTeamUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { announceRequesterRemoved, removeOrganizerFromEvent } from '@/collections/shared/removeOrganizer'
import { logger, serializeError } from '@/lib/logger'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * The obec decides a request the requester escalated to it (…/escalate): `remove` takes them off
 * the event without the other organizers' consent — a pořadatel hands it over to the spolupořadatel
 * who refused (or, if they've left meanwhile, to another one) — or the obec turns it down and
 * everything stays. Any admin of the event's obec, or a platform admin.
 *
 * POST /api/events/deletion-requests/:id/municipality-decide  { remove: boolean }
 * → { status: 'requester-removed' | 'escalation-rejected' }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { remove?: unknown } | null
  if (typeof body?.remove !== 'boolean') {
    return NextResponse.json({ error: 'Chybí rozhodnutí.' }, { status: 400 })
  }

  const deletionRequest = await payload
    .findByID({ collection: 'event-deletion-requests', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!deletionRequest) return NextResponse.json({ error: 'Žádost neexistuje.' }, { status: 404 })

  const uid = String(user.id)
  const municipalityId = relationId(deletionRequest.municipality)
  const forObec =
    user.role === 'admin' ||
    (municipalityId !== null && (await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId))
  if (!forObec) return NextResponse.json({ error: 'O téhle žádosti rozhoduje obec.' }, { status: 403 })
  // afterRead already reports a request whose event has started as "expired".
  if (deletionRequest.status !== 'escalated') {
    return NextResponse.json(
      {
        error:
          deletionRequest.status === 'expired'
            ? 'Akce už začala — o žádosti už rozhodnout nejde.'
            : 'O žádosti už bylo rozhodnuto.',
      },
      { status: 409 },
    )
  }

  const eventId = relationId(deletionRequest.event)
  const event = eventId
    ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }).catch(() => null)
    : null
  if (!event || event.deletedAt) return NextResponse.json({ error: 'Akce už neexistuje.' }, { status: 409 })

  const requesterId = relationId(deletionRequest.requestedBy)!
  const decidedAt = new Date().toISOString()

  if (!body.remove) {
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: { status: 'escalation-rejected', decidedBy: user.id, decidedAt },
      overrideAccess: true,
    })
    const team = await getEventTeamUserIds(payload, event, { exclude: [uid, requesterId] })
    sendNotificationToMany(payload, [requesterId], {
      title: 'Obec žádost zamítla',
      link: `/akce/${event.id}`,
      message: `Obec nevyhověla vaší žádosti o zrušení spolupořadatelství akce „${event.title}“ — akci pořádáte dál.`,
    })
    sendNotificationToMany(payload, team, {
      title: 'Obec žádost zamítla',
      link: `/akce/${event.id}`,
      message: `Obec rozhodla, že pořadatelé akce „${event.title}“ zůstávají, jak jsou.`,
    })
    writeAuditLog(payload, {
      action: 'event-deletion-requests.municipality-reject',
      actor: user.id,
      targetCollection: 'event-deletion-requests',
      targetId: deletionRequest.id,
      municipality: Number(municipalityId) || null,
      metadata: { event: event.id, requestedBy: requesterId },
    })
    return NextResponse.json({ status: 'escalation-rejected' })
  }

  const onEvent = eventOrganizerIds(event)
  if (!onEvent.includes(requesterId)) {
    return NextResponse.json({ error: 'Žadatel už akci nepořádá.' }, { status: 409 })
  }
  // A pořadatel leaving hands the event over — to whoever refused, if they're still on it.
  let successorId: string | null = null
  if (relationId(event.organizer) === requesterId) {
    const rejectedById = relationId(deletionRequest.rejectedBy)
    const coOrganizerIds = (event.coOrganizers ?? []).map(relationId).filter((x): x is string => x !== null)
    successorId = rejectedById && coOrganizerIds.includes(rejectedById) ? rejectedById : (coOrganizerIds[0] ?? null)
    if (!successorId) {
      return NextResponse.json({ error: 'Akci nemá kdo převzít — žádný spolupořadatel nezbyl.' }, { status: 409 })
    }
  }

  const req = await createLocalReq({ user }, payload)
  const shouldCommit = await initTransaction(req)
  let updated
  try {
    updated = await removeOrganizerFromEvent(req, event, requesterId, successorId)
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: {
        status: 'requester-removed',
        successor: successorId ? Number(successorId) : null,
        decidedBy: user.id,
        decidedAt,
      },
      overrideAccess: true,
      req,
    })
    if (shouldCommit) await commitTransaction(req)
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    if (error instanceof APIError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    logger.error('Obec removing the deletion requester failed', {
      event: 'events.municipality_requester_removal_failed',
      eventId: event.id,
      requestId: deletionRequest.id,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Žadatele se nepodařilo z akce odebrat.' }, { status: 500 })
  }

  await announceRequesterRemoved(payload, { event: updated, requesterId, successorId, deciderId: uid, byObec: true })
  writeAuditLog(payload, {
    action: 'event-deletion-requests.municipality-remove',
    actor: user.id,
    targetCollection: 'event-deletion-requests',
    targetId: deletionRequest.id,
    municipality: Number(municipalityId) || null,
    metadata: { event: event.id, requestedBy: requesterId, successor: successorId },
  })
  return NextResponse.json({ status: 'requester-removed' })
}
