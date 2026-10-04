import { NextResponse } from 'next/server'
import { APIError, commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'

import config from '@payload-config'
import { eventOrganizerIds, obecRole } from '@/collections/Events'
import { getEventRegistrants, notifyEventCancelled } from '@/collections/shared/eventNotifications'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { getEventTeamUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { announceRequesterRemoved, removeOrganizerFromEvent } from '@/collections/shared/removeOrganizer'
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { logger, serializeError } from '@/lib/logger'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

const DECISIONS = ['approve', 'reject', 'remove-requester'] as const
type Decision = (typeof DECISIONS)[number]

/**
 * A spolupořadatel answers a request to delete the event they run together
 * (EventDeletionRequests) — or an obec admin, for the obec co-organizing it. A refusal keeps the
 * event; once everyone asked (the obec included) has consented the event
 * is hard-deleted — with its registrations, their feedback and photos,
 * in one transaction — and the registrants are told it's off. Or an organizer keeps the event
 * but lets the requester go: the requester leaves it (handing it over to them, if the requester
 * was its pořadatel) and the request is settled — nobody else's answer matters any more, the event
 * can't be deleted against their will anyway.
 *
 * POST /api/events/deletion-requests/:id/decide  { decision: 'approve' | 'reject' | 'remove-requester' }
 * → { status: 'pending' | 'approved' | 'rejected' | 'requester-removed' }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { decision?: unknown } | null
  const decision = body?.decision as Decision
  if (!DECISIONS.includes(decision)) {
    return NextResponse.json({ error: 'Chybí rozhodnutí.' }, { status: 400 })
  }

  const deletionRequest = await payload
    .findByID({ collection: 'event-deletion-requests', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!deletionRequest) return NextResponse.json({ error: 'Žádost neexistuje.' }, { status: 404 })

  const uid = String(user.id)
  const approverIds = (deletionRequest.approvers ?? []).map(relationId)
  const municipalityId = relationId(deletionRequest.municipality)
  const forObec =
    Boolean(deletionRequest.municipalityConsent) &&
    municipalityId !== null &&
    (await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)
  if (!approverIds.includes(uid) && !forObec) {
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
  const asApprover = approverIds.includes(uid) && onEvent.has(uid)
  if (!asApprover && !forObec) {
    return NextResponse.json({ error: 'Tuhle akci už nepořádáte.' }, { status: 403 })
  }
  // Once the obec's admins take it off the event, its consent is no longer needed.
  const obecStillCoOrganizes =
    Boolean(deletionRequest.municipalityConsent) &&
    (await obecRole(await createLocalReq({ user }, payload), event)).coOrganizes

  const requesterId = relationId(deletionRequest.requestedBy)!
  const decidedAt = new Date().toISOString()

  if (decision === 'remove-requester') {
    // The obec answers only for itself — whom the event stays with is the organizers' call.
    if (!asApprover) {
      return NextResponse.json({ error: 'Odebrat žadatele může jen spolupořadatel akce.' }, { status: 403 })
    }
    if (!onEvent.has(requesterId)) {
      return NextResponse.json({ error: 'Žadatel už akci nepořádá.' }, { status: 409 })
    }
    const successorId = relationId(event.organizer) === requesterId ? uid : null

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
      // E.g. the successor no longer organizes in the obec (Events requireOrganizerRole).
      if (error instanceof APIError && error.status < 500) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      logger.error('Removing the deletion requester failed', {
        event: 'events.requester_removal_failed',
        eventId: event.id,
        requestId: deletionRequest.id,
        ...serializeError(error),
      })
      return NextResponse.json({ error: 'Žadatele se nepodařilo z akce odebrat.' }, { status: 500 })
    }

    await announceRequesterRemoved(payload, { event: updated, requesterId, successorId, deciderId: uid, byObec: false })
    writeAuditLog(payload, {
      action: 'event-deletion-requests.requester-removed',
      actor: user.id,
      targetCollection: 'event-deletion-requests',
      targetId: deletionRequest.id,
      municipality: Number(relationId(event.municipality)) || null,
      metadata: { event: event.id, requestedBy: requesterId, successor: successorId },
    })
    return NextResponse.json({ status: 'requester-removed' })
  }

  if (decision === 'reject') {
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: { status: 'rejected', decidedBy: user.id, decidedAt, rejectedBy: asApprover ? user.id : null },
      overrideAccess: true,
    })
    // The requester, and everyone else who was asked — the event stays for all of them. The
    // requester may still turn to the obec to leave it (…/escalate).
    const who = asApprover ? 'Spolupořadatel nesouhlasil' : 'Obec nesouhlasila'
    const team = await getEventTeamUserIds(payload, event, { exclude: [uid, requesterId] })
    sendNotificationToMany(payload, [requesterId], {
      title: 'Smazání akce zamítnuto',
      link: `/akce/${event.id}`,
      message: asApprover
        ? `${who} se smazáním akce „${event.title}“ ani s tím, abyste ji opustili — akce zůstává. Pokud ji pořádat nechcete, můžete požádat obec o zrušení spolupořadatelství.`
        : `${who} se smazáním akce „${event.title}“ — akce zůstává.`,
    })
    sendNotificationToMany(payload, team, {
      title: 'Smazání akce zamítnuto',
      link: `/akce/${event.id}`,
      message: `${who} se smazáním akce „${event.title}“ — akce zůstává.`,
    })
    return NextResponse.json({ status: 'rejected' })
  }

  const approvedBy = [
    ...new Set([...(deletionRequest.approvedBy ?? []).map(relationId), ...(asApprover ? [uid] : [])]),
  ].filter((a): a is string => a !== null)
  const municipalityApprovedBy = forObec ? uid : relationId(deletionRequest.municipalityApprovedBy)
  const stillWaiting = approverIds.filter((a) => a && onEvent.has(a) && !approvedBy.includes(a))
  if (stillWaiting.length > 0 || (obecStillCoOrganizes && !municipalityApprovedBy)) {
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: {
        approvedBy: approvedBy.map(Number),
        municipalityApprovedBy: municipalityApprovedBy ? Number(municipalityApprovedBy) : null,
      },
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

  // Collected up front — the registrations go with the event, and so would the ids of their
  // reminder jobs.
  const registrants = await getEventRegistrants(payload, event.id, relationId(event.organizer)!)
  // Likewise everyone running it — the obec's admins included when it co-organizes.
  const team = await getEventTeamUserIds(payload, event, { exclude: [uid] })

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
    for (const collection of [
      'review-complaints',
      'volunteer-ratings',
      'volunteer-invitations',
      'registrations',
      'event-media',
      'co-organizing-requests',
    ] as const) {
      await payload.delete({ collection, where: { event: { equals: event.id } }, overrideAccess: true, req })
    }
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: {
        status: 'approved',
        approvedBy: approvedBy.map(Number),
        municipalityApprovedBy: municipalityApprovedBy ? Number(municipalityApprovedBy) : null,
        decidedBy: user.id,
        decidedAt,
      },
      overrideAccess: true,
      req,
    })
    // The organizers asked for this themselves — Events' "obec deleted your event" stays quiet.
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true, req, context: { coOrganizerConsent: true } })
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
    await notifyEventCancelled(payload, event, { registrants })
  } catch (error) {
    payload.logger.error(`Failed to notify registrants of deleted event ${event.id}: ${error}`)
  }
  sendNotificationToMany(payload, team, {
    title: 'Akce smazána',
    message: `Akce „${event.title}“ byla se souhlasem všech spolupořadatelů${obecStillCoOrganizes ? ' i obce' : ''} smazána.`,
  })
  writeAuditLog(payload, {
    action: 'events.consented_delete',
    actor: user.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(relationId(event.municipality)) || null,
    metadata: { title: event.title, requestedBy: requesterId, approvedBy, municipalityApprovedBy },
  })

  return NextResponse.json({ status: 'approved' })
}
