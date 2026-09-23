import { NextResponse } from 'next/server'
import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'

import config from '@payload-config'
import { eventOrganizerIds, getRegistrantIdsToNotify, notifyEventCancelled } from '@/collections/Events'
import { sendNotification } from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { logger, serializeError } from '@/lib/logger'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * A spolupořadatel answers a request to delete the event they run together
 * (EventDeletionRequests). A refusal keeps the event; once everyone asked has consented the event
 * is hard-deleted — with its registrations, their feedback, photos and volunteering-flag requests,
 * in one transaction — and the registrants are told it's off.
 *
 * POST /api/events/deletion-requests/:id/decide  { approve: boolean }
 * → { status: 'pending' | 'approved' | 'rejected' }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { approve?: unknown } | null
  if (typeof body?.approve !== 'boolean') {
    return NextResponse.json({ error: 'Chybí rozhodnutí.' }, { status: 400 })
  }

  const deletionRequest = await payload
    .findByID({ collection: 'event-deletion-requests', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!deletionRequest) return NextResponse.json({ error: 'Žádost neexistuje.' }, { status: 404 })

  const uid = String(user.id)
  const approverIds = (deletionRequest.approvers ?? []).map(relationId)
  if (!approverIds.includes(uid)) {
    return NextResponse.json({ error: 'O téhle žádosti nerozhodujete.' }, { status: 403 })
  }
  // afterRead already reports a lapsed request as "expired".
  if (deletionRequest.status !== 'pending') {
    return NextResponse.json(
      {
        error:
          deletionRequest.status === 'expired'
            ? 'Na žádost už vypršel čas — akce zůstává.'
            : 'O žádosti už bylo rozhodnuto.',
      },
      { status: 409 },
    )
  }

  const eventId = relationId(deletionRequest.event)
  const event = eventId
    ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }).catch(() => null)
    : null
  if (!event || event.deletedAt) {
    return NextResponse.json({ error: 'Akce už neexistuje.' }, { status: 409 })
  }
  // Someone who has since left the event no longer has a say (and nor does their consent count).
  const onEvent = new Set(eventOrganizerIds(event))
  if (!onEvent.has(uid)) {
    return NextResponse.json({ error: 'Tuhle akci už nepořádáte.' }, { status: 403 })
  }

  const requesterId = relationId(deletionRequest.requestedBy)!
  const decidedAt = new Date().toISOString()

  if (!body.approve) {
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: { status: 'rejected', decidedBy: user.id, decidedAt },
      overrideAccess: true,
    })
    sendNotification(payload, {
      userId: requesterId,
      title: 'Smazání akce zamítnuto',
      link: `/akce/${event.id}`,
      message: `Spolupořadatel nesouhlasil se smazáním akce „${event.title}“ — akce zůstává.`,
    })
    return NextResponse.json({ status: 'rejected' })
  }

  const approvedBy = [...new Set([...(deletionRequest.approvedBy ?? []).map(relationId), uid])]
  const stillWaiting = approverIds.filter((a) => a && onEvent.has(a) && !approvedBy.includes(a))
  if (stillWaiting.length > 0) {
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: { approvedBy: approvedBy.map(Number) },
      overrideAccess: true,
    })
    return NextResponse.json({ status: 'pending' })
  }

  if (!canCancelEvent(event.dateTime)) {
    return NextResponse.json(
      { error: `Akci lze smazat nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.` },
      { status: 409 },
    )
  }

  // Collected up front — the registrations go with the event.
  const registrantIds = await getRegistrantIdsToNotify(payload, event.id, relationId(event.organizer)!)

  const req = await createLocalReq({ user }, payload)
  const shouldCommit = await initTransaction(req)
  try {
    const registrations = await payload.find({
      collection: 'registrations',
      where: { event: { equals: event.id } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
    if (registrations.docs.length > 0) {
      await payload.delete({
        collection: 'event-feedback',
        where: { registration: { in: registrations.docs.map((r) => r.id) } },
        overrideAccess: true,
        req,
      })
    }
    for (const collection of ['registrations', 'event-media', 'volunteer-flag-requests'] as const) {
      await payload.delete({ collection, where: { event: { equals: event.id } }, overrideAccess: true, req })
    }
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: { status: 'approved', approvedBy: approvedBy.map(Number), decidedBy: user.id, decidedAt },
      overrideAccess: true,
      req,
    })
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true, req })
    if (shouldCommit) await commitTransaction(req)
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    logger.error('Consented event deletion failed', {
      event: 'events.consented_deletion_failed',
      eventId: event.id,
      requestId: deletionRequest.id,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Akci se nepodařilo smazat.' }, { status: 500 })
  }

  try {
    await notifyEventCancelled(payload, event, registrantIds)
  } catch (error) {
    payload.logger.error(`Failed to notify registrants of deleted event ${event.id}: ${error}`)
  }
  for (const organizerId of onEvent) {
    if (organizerId === uid) continue
    sendNotification(payload, {
      userId: organizerId,
      title: 'Akce smazána',
      message: `Akce „${event.title}“ byla se souhlasem všech spolupořadatelů smazána.`,
    })
  }
  writeAuditLog(payload, {
    action: 'events.consented_delete',
    actor: user.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(relationId(event.municipality)) || null,
    metadata: { title: event.title, requestedBy: requesterId, approvedBy },
  })

  return NextResponse.json({ status: 'approved' })
}
