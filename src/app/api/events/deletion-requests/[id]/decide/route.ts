import { NextResponse } from 'next/server'
import { APIError, commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'

import config from '@payload-config'
import { eventOrganizerIds, isEventCreator, neighbourObceOf, obecRole } from '@/collections/Events'
import { askForDeletionConsent, obceWithAdmins } from '@/collections/EventDeletionRequests'
import { getEventRegistrants, notifyEventCancelled } from '@/collections/shared/eventNotifications'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { getEventTeamUserIds, getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import {
  announceObecRemoved,
  announceRequesterRemoved,
  eligibleSuccessorIds,
  handOverToObec,
  removeObecFromEvent,
  removeOrganizerFromEvent,
} from '@/collections/shared/removeOrganizer'
import { lockRow } from '@/lib/db-lock'
import { DELETION_CONSENT_HOURS } from '@/lib/requestDeadlines'
import { eventCancellationDeadline } from '@/lib/eventCancellation'
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { logger, serializeError } from '@/lib/logger'
import { relationId } from '@/lib/relations'

const DECISIONS = ['approve', 'reject', 'remove-requester'] as const
type Decision = (typeof DECISIONS)[number]

/**
 * A spolupořadatel answers a request to delete the event they run together
 * (EventDeletionRequests) — an admin of a neighbouring obec co-organizing it answering as one, for
 * that obec — or an obec admin, for the obec running or co-organizing it. A refusal
 * keeps the event; once everyone asked (the obec included) has consented the event
 * is hard-deleted — with its registrations, their feedback and photos,
 * in one transaction — and the registrants are told it's off. Or an organizer — or the obec, when
 * it runs the event — keeps the event but lets the requester go: the requester leaves it (handing it
 * over to them, if the requester was its pořadatel) and the request is settled — nobody else's
 * answer matters any more, the event can't be deleted against their will anyway.
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
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  // An obec's admins answer for it — the platform admins while it has none, so no consent waits on
  // nobody (EventDeletionRequests deciderIdsForObec).
  const answersFor = async (obecId: string) =>
    administeredIds.includes(obecId) ||
    (user.role === 'admin' && (await getMunicipalityAdminUserIds(payload, obecId)).length === 0)
  const forObec =
    Boolean(deletionRequest.municipalityConsent) && municipalityId !== null && (await answersFor(municipalityId))
  const askedNeighbours = (deletionRequest.neighbourMunicipalities ?? [])
    .map(relationId)
    .filter((m): m is string => m !== null)
  const neighbourApproved = (deletionRequest.neighbourApproved ?? [])
    .map(relationId)
    .filter((m): m is string => m !== null)
  const myNeighbours: string[] = []
  for (const m of askedNeighbours) if (administeredIds.includes(m)) myNeighbours.push(m)
  if (!approverIds.includes(uid) && !forObec && myNeighbours.length === 0) {
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
  // Someone who has since left the event no longer has a say (and nor does their consent count) —
  // nor does a neighbouring obec that no longer co-organizes it.
  const localReq = await createLocalReq({ user }, payload)
  const onEvent = new Set(eventOrganizerIds(event))
  const neighboursOnEvent = new Set(await neighbourObceOf(localReq, event))
  const asApprover = approverIds.includes(uid) && onEvent.has(uid)
  // The neighbouring obec the admin answers for — one still asked, else one that already consented.
  const neighbourMine = myNeighbours.filter((m) => neighboursOnEvent.has(m))
  const forNeighbour = neighbourMine.find((m) => !neighbourApproved.includes(m)) ?? neighbourMine[0] ?? null
  if (!asApprover && !forObec && !forNeighbour) {
    return NextResponse.json({ error: 'Tuhle akci už nepořádáte.' }, { status: 403 })
  }
  // Once the obec's admins take it off the event, its consent is no longer needed.
  const obec = await obecRole(localReq, event)
  const obecStillTakesPart = Boolean(deletionRequest.municipalityConsent) && (obec.runs || obec.coOrganizes)

  const requesterId = relationId(deletionRequest.requestedBy)!
  // Asked for a neighbouring obec — it's the obec that leaves, not its admin.
  const requesterObec = relationId(deletionRequest.requesterMunicipality)
  const decidedAt = new Date().toISOString()

  if (decision === 'remove-requester') {
    // The obec co-organizing answers only for itself — whom the event stays with is the organizers'
    // call. Running it, the obec is the one the event stays with.
    const requesterRuns = !requesterObec && relationId(event.organizer) === requesterId
    // The obec co-organizing takes the event over from its leaving pořadatel — the last resort when
    // nobody else may (handOverToObec). Its admin becomes the pořadatel.
    const obecTakesOver =
      requesterRuns && !asApprover && forObec && obec.coOrganizes && administeredIds.includes(municipalityId ?? '')
    if (!asApprover && !forNeighbour && !(forObec && obec.runs) && !obecTakesOver) {
      return NextResponse.json({ error: 'Odebrat žadatele může jen spolupořadatel akce.' }, { status: 403 })
    }
    if (requesterObec ? !neighboursOnEvent.has(requesterObec) : !onEvent.has(requesterId)) {
      return NextResponse.json({ error: 'Žadatel už akci nepořádá.' }, { status: 409 })
    }
    // The event passes to whoever keeps it — a pořadatel with a role in its obec, or the obec;
    // never a neighbouring obec.
    if (requesterRuns && !asApprover && !(forObec && obec.runs) && !obecTakesOver) {
      return NextResponse.json(
        { error: 'Akci po pořadateli převzít nemůžete — souhlaste se smazáním, nebo ho odmítněte.' },
        { status: 409 },
      )
    }
    if (
      requesterRuns &&
      asApprover &&
      (await eligibleSuccessorIds(payload, relationId(event.municipality)!, [uid])).length === 0
    ) {
      return NextResponse.json(
        {
          error:
            'Akci převzít nemůžete — v obci, kde se koná, nemáte roli organizátora. Souhlaste se smazáním, nebo ho odmítněte.',
        },
        { status: 409 },
      )
    }
    const successorId = requesterRuns ? uid : null

    const req = await createLocalReq({ user }, payload)
    const shouldCommit = await initTransaction(req)
    let updated
    try {
      updated = requesterObec
        ? await removeObecFromEvent(req, event, requesterObec)
        : obecTakesOver
          ? await handOverToObec(req, event, uid)
          : await removeOrganizerFromEvent(req, event, requesterId, successorId)
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

    if (requesterObec) {
      await announceObecRemoved(payload, { event: updated, municipalityId: requesterObec, deciderId: uid, byObec: false })
    } else {
      await announceRequesterRemoved(payload, { event: updated, requesterId, successorId, deciderId: uid, byObec: false })
    }
    writeAuditLog(payload, {
      source: request,
      action: 'event-deletion-requests.requester-removed',
      actor: user.id,
      targetCollection: 'event-deletion-requests',
      targetId: deletionRequest.id,
      municipality: Number(relationId(event.municipality)) || null,
      metadata: { event: event.id, requestedBy: requesterId, requesterObec, successor: successorId },
    })
    return NextResponse.json({ status: 'requester-removed' })
  }

  if (decision === 'reject') {
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      // A neighbouring obec refuses as a spolupořadatel does — the requester may then turn to the obec.
      data: {
        status: 'rejected',
        decidedBy: user.id,
        decidedAt,
        rejectedBy: asApprover || forNeighbour ? user.id : null,
      },
      overrideAccess: true,
    })
    writeAuditLog(payload, {
      source: request,
      action: 'event-deletion-requests.reject',
      actor: user.id,
      targetCollection: 'event-deletion-requests',
      targetId: deletionRequest.id,
      municipality: Number(relationId(event.municipality)) || null,
      metadata: { event: event.id, requestedBy: requesterId, forObec: !asApprover && !forNeighbour, forNeighbour },
    })
    // The requester, and everyone else who was asked — the event stays for all of them. The
    // requester may still turn to the obec to leave it (…/escalate).
    const asSpolupořadatel = asApprover || Boolean(forNeighbour)
    const who = asApprover
      ? 'Spolupořadatel nesouhlasil'
      : forNeighbour
        ? 'Spolupořádající obec nesouhlasila'
        : 'Obec nesouhlasila'
    const team = await getEventTeamUserIds(payload, event, { exclude: [uid, requesterId] })
    sendNotificationToMany(payload, [requesterId], {
      title: 'Smazání akce zamítnuto',
      link: `/akce/${event.id}`,
      message: asSpolupořadatel
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

  // Consents land one at a time: the request row stays locked while this one is counted, so two
  // people answering at once can't overwrite each other.
  const lockReq = await createLocalReq({ user }, payload)
  const lockCommit = await initTransaction(lockReq)
  let fresh
  try {
    await lockRow(lockReq, 'event_deletion_requests', deletionRequest.id)
    fresh = await payload.findByID({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      depth: 0,
      overrideAccess: true,
      req: lockReq,
    })
  } catch (error) {
    if (lockCommit) await killTransaction(lockReq)
    throw error
  }
  const release = async () => {
    if (lockCommit) await commitTransaction(lockReq)
  }
  if (fresh.status !== 'pending') {
    await release()
    return NextResponse.json({ error: 'O žádosti už bylo rozhodnuto.' }, { status: 409 })
  }

  const approvedBy = [
    ...new Set([...(fresh.approvedBy ?? []).map(relationId), ...(asApprover ? [uid] : [])]),
  ].filter((a): a is string => a !== null)
  const municipalityApprovedBy = forObec ? uid : relationId(fresh.municipalityApprovedBy)
  const neighboursApproved = [
    ...new Set([
      ...(fresh.neighbourApproved ?? []).map(relationId).filter((m): m is string => m !== null),
      ...(forNeighbour ? [forNeighbour] : []),
    ]),
  ]

  // A spolupořadatel's request that only the creator was asked (EventDeletionRequests creatorOnly):
  // the pořadatel agreeing makes it their own request — the rest of the spolupořadatelé still have
  // to consent, so the two of them can't drop the event on the others. The obec running the event
  // may cancel it anyway, so its consent settles it.
  const req0 = await createLocalReq({ user }, payload)
  if (fresh.creatorOnly && asApprover && (await isEventCreator(req0, user, event)) && !obec.runs) {
    const others = eventOrganizerIds(event).filter((id) => id !== uid && id !== requesterId)
    const neighbours = await obceWithAdmins(payload, [...neighboursOnEvent])
    if (others.length > 0 || neighbours.length > 0 || obec.coOrganizes) {
      const expiresAt = Math.min(
        Date.now() + DELETION_CONSENT_HOURS * 60 * 60 * 1000,
        eventCancellationDeadline(event.dateTime).getTime(),
      )
      let converted
      try {
        converted = await payload.update({
          collection: 'event-deletion-requests',
          id: deletionRequest.id,
          data: {
            creatorOnly: false,
            approvers: [Number(uid), ...others.map(Number)],
            approvedBy: [Number(uid)],
            neighbourMunicipalities: neighbours.map(Number),
            neighbourApproved: [],
            municipalityConsent: obec.coOrganizes,
            municipalityApprovedBy: null,
            expiresAt: new Date(expiresAt).toISOString(),
          },
          overrideAccess: true,
          req: lockReq,
        })
        await release()
      } catch (error) {
        if (lockCommit) await killTransaction(lockReq)
        throw error
      }
      const [creator, asker] = await Promise.all(
        [uid, requesterId].map(async (id) => {
          const p = await payload.find({
            collection: 'profiles',
            where: { user: { equals: id } },
            depth: 0,
            limit: 1,
            overrideAccess: true,
          })
          return p.docs[0]?.fullName || 'Spolupořadatel'
        }),
      )
      await askForDeletionConsent(
        payload,
        { ...converted, approvers: others.map(Number) },
        `Pořadatel ${creator} souhlasí se žádostí ${asker} a`,
      )
      return NextResponse.json({ status: 'pending' })
    }
  }

  const stillWaiting = ((fresh.approvers ?? []).map(relationId) as (string | null)[]).filter(
    (a): a is string => a !== null && onEvent.has(a) && !approvedBy.includes(a),
  )
  // A neighbouring obec that has since lost its last admin no longer holds the request up.
  const neighboursWaiting = await obceWithAdmins(
    payload,
    ((fresh.neighbourMunicipalities ?? []).map(relationId) as (string | null)[]).filter(
      (m): m is string => m !== null && neighboursOnEvent.has(m) && !neighboursApproved.includes(m),
    ),
  )
  if (stillWaiting.length > 0 || neighboursWaiting.length > 0 || (obecStillTakesPart && !municipalityApprovedBy)) {
    try {
      await payload.update({
        collection: 'event-deletion-requests',
        id: deletionRequest.id,
        data: {
          approvedBy: approvedBy.map(Number),
          neighbourApproved: neighboursApproved.map(Number),
          municipalityApprovedBy: municipalityApprovedBy ? Number(municipalityApprovedBy) : null,
        },
        overrideAccess: true,
        req: lockReq,
      })
      await release()
    } catch (error) {
      if (lockCommit) await killTransaction(lockReq)
      throw error
    }
    return NextResponse.json({ status: 'pending' })
  }
  // Everyone has consented — the deletion below runs in its own transaction.
  await release()

  if (!canCancelEvent(event.dateTime)) {
    return NextResponse.json(
      { error: `Akci lze smazat nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.` },
      { status: 409 },
    )
  }

  // Collected up front — the registrations go with the event (Events cleanupEventRelations), and
  // so would the ids of their reminder jobs.
  const registrants = await getEventRegistrants(payload, event.id, relationId(event.organizer)!)
  // Likewise everyone running it — the obec's admins included when it co-organizes.
  const team = await getEventTeamUserIds(payload, event, { exclude: [uid] })

  const req = await createLocalReq({ user }, payload)
  const shouldCommit = await initTransaction(req)
  try {
    // Registrations, photos, invitations… go with the event (Events cleanupEventRelations).
    await payload.update({
      collection: 'event-deletion-requests',
      id: deletionRequest.id,
      data: {
        status: 'approved',
        approvedBy: approvedBy.map(Number),
        neighbourApproved: neighboursApproved.map(Number),
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
    message: `Akce „${event.title}“ byla se souhlasem všech spolupořadatelů${obecStillTakesPart ? ' i obce' : ''} smazána.`,
  })
  writeAuditLog(payload, {
    source: request,
    action: 'events.consented_delete',
    actor: user.id,
    targetCollection: 'events',
    targetId: event.id,
    municipality: Number(relationId(event.municipality)) || null,
    metadata: { title: event.title, requestedBy: requesterId, approvedBy, municipalityApprovedBy },
  })

  return NextResponse.json({ status: 'approved' })
}
