import { NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import config from '@payload-config'
import { eventOrganizerIds, neighbourObceOf } from '@/collections/Events'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { OPEN_STATUSES } from '@/collections/EventDeletionRequests'
import {
  escapeHtml,
  getMunicipalityAdminUserIds,
  getObecDeciders,
  sendNotification,
  sendNotificationToMany,
} from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { formatPragueDateTime } from '@/lib/date'
import { relationId } from '@/lib/relations'

/**
 * The requester turns to the obec after a spolupořadatel refused both deleting the event and
 * letting them leave it (EventDeletionRequests) — or after nobody answered in time: keeping quiet
 * mustn't hold them on the event more firmly than saying no. The obec's admins may then take them
 * off the event without the others' consent (…/municipality-decide) — until the event starts, when
 * the request lapses.
 *
 * POST /api/events/deletion-requests/:id/escalate → { status: 'escalated' }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deletionRequest = await payload
    .findByID({ collection: 'event-deletion-requests', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!deletionRequest) return NextResponse.json({ error: 'Žádost neexistuje.' }, { status: 404 })

  const uid = String(user.id)
  const requesterId = relationId(deletionRequest.requestedBy)!
  // Asked for a neighbouring obec — any of its admins turns to the obec for it.
  const requesterObec = relationId(deletionRequest.requesterMunicipality)
  const forRequesterObec =
    requesterObec !== null && (await getAdministeredMunicipalityIds(payload, user.id)).includes(requesterObec)
  if (requesterId !== uid && !forRequesterObec) {
    return NextResponse.json({ error: 'Obec může požádat jen ten, kdo o smazání žádal.' }, { status: 403 })
  }
  const rejectedById = relationId(deletionRequest.rejectedBy)
  // A spolupořadatel's refusal — the obec refusing for itself has already had its say — or a request
  // that lapsed unanswered (afterRead reports it "expired"; one the obec let lapse was escalated).
  const refused = deletionRequest.status === 'rejected' && rejectedById !== null
  const unanswered =
    deletionRequest.status === 'expired' && !deletionRequest.escalatedAt && !relationId(deletionRequest.decidedBy)
  if (!refused && !unanswered) {
    return NextResponse.json(
      { error: 'Obec lze požádat jen po zamítnutí spolupořadatelem, nebo když na žádost nikdo neodpověděl.' },
      { status: 409 },
    )
  }

  const eventId = relationId(deletionRequest.event)
  const event = eventId
    ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }).catch(() => null)
    : null
  if (!event || event.deletedAt) return NextResponse.json({ error: 'Akce už neexistuje.' }, { status: 409 })
  if (new Date(event.dateTime).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Akce už začala — obec už rozhodovat nemůže.' }, { status: 409 })
  }
  const organizerIds = eventOrganizerIds(event)
  const neighbours = await neighbourObceOf(await createLocalReq({ user }, payload), event)
  if (requesterObec ? !neighbours.includes(requesterObec) : !organizerIds.includes(uid)) {
    return NextResponse.json({ error: 'Tuhle akci už nepořádáte.' }, { status: 409 })
  }
  if (organizerIds.length + neighbours.length < 2) {
    return NextResponse.json({ error: 'Akci teď pořádáte sami — zrušit ji můžete rovnou.' }, { status: 409 })
  }

  const open = await payload.find({
    collection: 'event-deletion-requests',
    where: {
      and: [
        { event: { equals: event.id } },
        { status: { in: OPEN_STATUSES } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (open.docs.length > 0) return NextResponse.json({ error: 'O téhle akci už se rozhoduje.' }, { status: 409 })

  await payload.update({
    collection: 'event-deletion-requests',
    id: deletionRequest.id,
    data: { status: 'escalated', escalatedAt: new Date().toISOString(), expiresAt: event.dateTime },
    overrideAccess: true,
  })

  const profile = await payload.find({
    collection: 'profiles',
    where: { user: { equals: uid } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const requesterMunicipality = requesterObec
    ? await payload.findByID({ collection: 'municipalities', id: requesterObec, depth: 0, overrideAccess: true }).catch(() => null)
    : null
  const name = profile.docs[0]?.fullName || 'Spolupořadatel'
  const who = requesterMunicipality ? `${name} za obec ${requesterMunicipality.name}` : name
  const until = formatPragueDateTime(event.dateTime)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const municipalityId = relationId(event.municipality)
  const obec = municipalityId ? await getObecDeciders(payload, municipalityId) : { userIds: [], requestsLink: '' }
  for (const adminId of obec.userIds) {
    sendNotification(payload, {
      userId: adminId,
      title: 'Žádost o zrušení spolupořadatelství',
      link: obec.requestsLink,
      message: `${who} chce přestat pořádat akci „${event.title}“, ${refused ? 'ale spolupořadatel nesouhlasí' : 'a na jeho žádost nikdo neodpověděl'}. Rozhodněte do ${until}.`,
      email: {
        subject: `Žádost o zrušení spolupořadatelství: ${event.title}`,
        body:
          `<p><strong>${escapeHtml(who)}</strong> chce přestat pořádat akci <strong>${escapeHtml(event.title)}</strong>. ${refused ? 'Spolupořadatel nesouhlasil se smazáním akce ani s jeho odchodem.' : 'Na jeho žádost o smazání akce nikdo včas neodpověděl.'}</p>` +
          `<p>Obec ho z akce může odebrat i bez souhlasu spolupořadatele — akce pak zůstane ostatním. Rozhodnout můžete do ${until}.</p>` +
          `<p><a href="${appUrl}${obec.requestsLink}">Otevřít žádosti obce</a></p>`,
      },
    })
  }
  // Whoever refused — or everyone still on the event who left it unanswered.
  const approvedBy = new Set((deletionRequest.approvedBy ?? []).map(relationId))
  const silent = (deletionRequest.approvers ?? [])
    .map(relationId)
    .filter((id): id is string => id !== null && id !== uid && organizerIds.includes(id) && !approvedBy.has(id))
  // …and the admins of each neighbouring obec still on it that didn't answer.
  const neighbourApproved = new Set((deletionRequest.neighbourApproved ?? []).map(relationId))
  for (const m of (deletionRequest.neighbourMunicipalities ?? []).map(relationId)) {
    if (!m || !neighbours.includes(m) || neighbourApproved.has(m)) continue
    for (const adminId of await getMunicipalityAdminUserIds(payload, m)) if (String(adminId) !== uid) silent.push(String(adminId))
  }
  sendNotificationToMany(payload, refused ? [rejectedById!] : silent, {
    title: 'Spolupořadatel požádal obec',
    link: `/akce/${event.id}`,
    message: requesterMunicipality
      ? `${who} požádal(a) obec, kde se akce koná, aby obec ${requesterMunicipality.name} z akce „${event.title}“ odebrala i bez vašeho souhlasu.`
      : `${who} požádal(a) obec, aby ho z akce „${event.title}“ odebrala i bez vašeho souhlasu.`,
  })
  writeAuditLog(payload, {
    source: request,
    action: 'event-deletion-requests.escalate',
    actor: user.id,
    targetCollection: 'event-deletion-requests',
    targetId: deletionRequest.id,
    municipality: Number(municipalityId) || null,
    metadata: { event: event.id, rejectedBy: rejectedById, unanswered },
  })

  return NextResponse.json({ status: 'escalated' })
}
