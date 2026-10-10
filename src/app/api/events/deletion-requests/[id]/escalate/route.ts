import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { eventOrganizerIds } from '@/collections/Events'
import { OPEN_STATUSES } from '@/collections/EventDeletionRequests'
import { escapeHtml, getObecDeciders, sendNotification } from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { formatPragueDateTime } from '@/lib/date'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * The requester turns to the obec after a spolupořadatel refused both deleting the event and
 * letting them leave it (EventDeletionRequests). The obec's admins may then take them off the event
 * without the others' consent (…/municipality-decide) — until the event starts, when the request
 * lapses.
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
  if (requesterId !== uid) {
    return NextResponse.json({ error: 'Obec může požádat jen ten, kdo o smazání žádal.' }, { status: 403 })
  }
  const rejectedById = relationId(deletionRequest.rejectedBy)
  // Only a spolupořadatel's refusal — the obec refusing for itself has already had its say.
  if (deletionRequest.status !== 'rejected' || !rejectedById) {
    return NextResponse.json({ error: 'Obec lze požádat jen po zamítnutí spolupořadatelem.' }, { status: 409 })
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
  if (!organizerIds.includes(uid)) return NextResponse.json({ error: 'Tuhle akci už nepořádáte.' }, { status: 409 })
  if (organizerIds.length < 2) {
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
  const who = profile.docs[0]?.fullName || 'Spolupořadatel'
  const until = formatPragueDateTime(event.dateTime)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const municipalityId = relationId(event.municipality)
  const obec = municipalityId ? await getObecDeciders(payload, municipalityId) : { userIds: [], requestsLink: '' }
  for (const adminId of obec.userIds) {
    sendNotification(payload, {
      userId: adminId,
      title: 'Žádost o zrušení spolupořadatelství',
      link: obec.requestsLink,
      message: `${who} chce přestat pořádat akci „${event.title}“, ale spolupořadatel nesouhlasí. Rozhodněte do ${until}.`,
      email: {
        subject: `Žádost o zrušení spolupořadatelství: ${event.title}`,
        body:
          `<p><strong>${escapeHtml(who)}</strong> chce přestat pořádat akci <strong>${escapeHtml(event.title)}</strong>. Spolupořadatel nesouhlasil se smazáním akce ani s jeho odchodem.</p>` +
          `<p>Obec ho z akce může odebrat i bez souhlasu spolupořadatele — akce pak zůstane ostatním. Rozhodnout můžete do ${until}.</p>` +
          `<p><a href="${appUrl}${obec.requestsLink}">Otevřít žádosti obce</a></p>`,
      },
    })
  }
  sendNotification(payload, {
    userId: rejectedById,
    title: 'Spolupořadatel požádal obec',
    link: `/akce/${event.id}`,
    message: `${who} požádal(a) obec, aby ho z akce „${event.title}“ odebrala i bez vašeho souhlasu.`,
  })
  writeAuditLog(payload, {
    action: 'event-deletion-requests.escalate',
    actor: user.id,
    targetCollection: 'event-deletion-requests',
    targetId: deletionRequest.id,
    municipality: Number(municipalityId) || null,
    metadata: { event: event.id, rejectedBy: rejectedById },
  })

  return NextResponse.json({ status: 'escalated' })
}
