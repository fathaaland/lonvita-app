import type { Payload, PayloadRequest } from 'payload'
import { APIError } from 'payload'

import { escapeHtml, getEventTeamUserIds, sendNotification, sendNotificationToMany } from './notify'
import type { Event } from '@/payload-types'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * Takes `leavingUserId` off the event, which goes on without them — the one way an organizer
 * leaves an event they run with others (EventDeletionRequests: the others agree, or the obec
 * decides). A spolupořadatel's organization drops off `coOrganizations`. The pořadatel hands the
 * event over to `successorUserId`, one of its spolupořadatelé: they become its `organizer`
 * (Events resolveOrganizations re-derives `organization` from them, requireOrganizerRole checks they
 * still organize in the obec) and with it everything that's the creator's alone — volunteering,
 * ratings. Pass the `req` of the transaction the request's own status change runs in.
 */
export async function removeOrganizerFromEvent(
  req: PayloadRequest,
  event: Pick<Event, 'id' | 'organizer' | 'coOrganizations'>,
  leavingUserId: number | string,
  successorUserId: number | string | null,
): Promise<Event> {
  const leaving = String(leavingUserId)
  const coOrganizationIds = (event.coOrganizations ?? []).map(relationId).filter((id): id is string => id !== null)
  const organizations =
    coOrganizationIds.length > 0
      ? (
          await req.payload.find({
            collection: 'organizations',
            where: { id: { in: coOrganizationIds } },
            depth: 0,
            pagination: false,
            overrideAccess: true,
            req,
          })
        ).docs
      : []
  const ownedBy = (userId: string) =>
    new Set(organizations.filter((o) => relationId(o.owner) === userId).map((o) => String(o.id)))

  let data: Partial<Event>
  if (relationId(event.organizer) === leaving) {
    const successor = successorUserId == null ? null : String(successorUserId)
    const successorOrganizations = successor ? ownedBy(successor) : new Set<string>()
    if (!successor || successor === leaving || successorOrganizations.size === 0) {
      throw new APIError('Akci nemá kdo převzít — nástupce už ji nespolupořádá.', 409)
    }
    data = {
      organizer: Number(successor),
      coOrganizations: coOrganizationIds.filter((id) => !successorOrganizations.has(id)).map(Number),
    }
  } else {
    const leavingOrganizations = ownedBy(leaving)
    if (leavingOrganizations.size === 0) throw new APIError('Tuhle akci už nespolupořádá.', 409)
    data = { coOrganizations: coOrganizationIds.filter((id) => !leavingOrganizations.has(id)).map(Number) }
  }

  // Agreed to by the others or decided by the obec — Events guardCoOrganizedChanges lets it through
  // and notifyOrganizersOnObecChange stays quiet (the caller announces it).
  return req.payload.update({
    collection: 'events',
    id: event.id,
    data,
    depth: 0,
    overrideAccess: true,
    context: { coOrganizerConsent: true },
    req,
  })
}

/**
 * Tells everyone that `requesterId` left the event (removeOrganizerFromEvent) — the requester, the
 * successor taking it over (if any) and the rest of the team, minus whoever decided.
 */
export async function announceRequesterRemoved(
  payload: Payload,
  {
    event,
    requesterId,
    successorId,
    deciderId,
    byObec,
  }: {
    event: Event
    requesterId: string
    successorId: string | null
    deciderId: string
    byObec: boolean
  },
): Promise<void> {
  const profile = await payload.find({
    collection: 'profiles',
    where: { user: { equals: requesterId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const who = profile.docs[0]?.fullName || 'Spolupořadatel'
  const link = `/akce/${event.id}`
  const title = escapeHtml(event.title)
  const reason = byObec
    ? 'Obec vyhověla vaší žádosti'
    : 'Spolupořadatel nechce akci smazat, ale souhlasil, že ji opustíte'

  if (requesterId !== deciderId) {
    sendNotification(payload, {
      userId: requesterId,
      title: 'Akci už nepořádáte',
      message: `${reason} — akci „${event.title}“ už nepořádáte, pokračuje beze vás.`,
      email: {
        subject: `Akci už nepořádáte: ${event.title}`,
        body: `<p>${escapeHtml(reason)} — akci <strong>${title}</strong> už nepořádáte, pokračuje beze vás.</p>`,
      },
    })
  }
  if (successorId && successorId !== deciderId) {
    sendNotification(payload, {
      userId: successorId,
      title: 'Akci teď vedete vy',
      link,
      message: `${who} akci „${event.title}“ opustil(a) a vy jste teď její hlavní pořadatel — i s dobrovolnictvím a hodnocením dobrovolníků.`,
    })
  }
  const team = await getEventTeamUserIds(payload, event, { exclude: [deciderId, requesterId, successorId] })
  sendNotificationToMany(payload, team, {
    title: 'Změna pořadatelů akce',
    link,
    message: `${who} akci „${event.title}“ už nepořádá${byObec ? ' — rozhodla tak obec' : ''}.${successorId ? ' Hlavním pořadatelem je teď její dosavadní spolupořadatel.' : ''}`,
  })
}
