import type { Payload, PayloadRequest } from 'payload'
import { APIError } from 'payload'

import {
  escapeHtml,
  getEventTeamUserIds,
  getMunicipalityAdminUserIds,
  sendNotification,
  sendNotificationToMany,
} from './notify'
import type { Event } from '@/payload-types'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'
import { municipalityOrganizationIds } from '../Organizations'
import { relationId } from '@/lib/relations'

/**
 * Takes `leavingUserId` off the event, which goes on without them — the one way an organizer
 * leaves an event they run with others (EventDeletionRequests: the others agree, or the obec
 * decides). A spolupořadatel's organization drops off `coOrganizations`. The pořadatel hands the
 * event over to `successorUserId`, one of its spolupořadatelé: they become its `organizer`
 * (Events resolveOrganizations re-derives `organization` from them, requireOrganizerRole checks they
 * still organize in the obec) and with it everything that's the creator's alone — volunteering,
 * ratings, and the volunteer invitations and offers still waiting, which go to them to answer or
 * withdraw. Pass the `req` of the transaction the request's own status change runs in.
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
  const updated = await req.payload.update({
    collection: 'events',
    id: event.id,
    data,
    depth: 0,
    overrideAccess: true,
    context: { coOrganizerConsent: true },
    req,
  })

  if (data.organizer !== undefined) {
    await req.payload.update({
      collection: 'volunteer-invitations',
      where: { and: [{ event: { equals: event.id } }, { status: { equals: 'pending' } }] },
      data: { invitedBy: data.organizer },
      overrideAccess: true,
      req,
    })
  }
  return updated
}

/**
 * The event's obec takes the event over from its leaving pořadatel when no spolupořadatel can — the
 * last resort that keeps a pořadatel from being held on an event nobody else may run. `obecAdminId`,
 * an admin of the event's obec, becomes its pořadatel and the event the obec's own (Events
 * resolveOrganizations); the obec's organization drops off the spolupořadatelé, as does the leaving
 * pořadatel's. The volunteer invitations still waiting go to the new pořadatel. Pass the `req` of the
 * transaction the request's own status change runs in.
 */
export async function handOverToObec(
  req: PayloadRequest,
  event: Pick<Event, 'id' | 'organizer' | 'organization' | 'coOrganizations' | 'municipality'>,
  obecAdminId: number | string,
): Promise<Event> {
  const municipalityId = relationId(event.municipality)!
  const obecOrganizationId = (await municipalityOrganizationIds(req, [municipalityId])).get(municipalityId)
  const leavingOrganizationId = relationId(event.organization)
  const coOrganizationIds = (event.coOrganizations ?? [])
    .map(relationId)
    .filter((id): id is string => id !== null && id !== obecOrganizationId && id !== leavingOrganizationId)
  const updated = await req.payload.update({
    collection: 'events',
    id: event.id,
    data: { organizer: Number(obecAdminId), coOrganizations: coOrganizationIds.map(Number) },
    depth: 0,
    overrideAccess: true,
    context: { coOrganizerConsent: true },
    req,
  })
  await req.payload.update({
    collection: 'volunteer-invitations',
    where: { and: [{ event: { equals: event.id } }, { status: { equals: 'pending' } }] },
    data: { invitedBy: Number(obecAdminId) },
    overrideAccess: true,
    req,
  })
  return updated
}

/**
 * The admin of the event's obec who takes it over (handOverToObec) when its pořadatel leaves and no
 * spolupořadatel may: `deciderId` if they're one, else — a platform admin deciding — the obec's first
 * admin. Null when the obec has none: nobody can run the event, it can only be cancelled.
 */
export async function obecSuccessorId(
  payload: Payload,
  municipalityId: string,
  deciderId: string,
): Promise<string | null> {
  const admins = (await getMunicipalityAdminUserIds(payload, municipalityId)).map(String)
  return admins.includes(deciderId) ? deciderId : (admins[0] ?? null)
}

/** The spolupořadatelé (users) who may run the event themselves — holding a role in its obec. A
 * neighbour's owner organizing only in their own obec can't (Events requireOrganizerRole). */
export async function eligibleSuccessorIds(
  payload: Payload,
  municipalityId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return []
  const roles = await payload.find({
    collection: 'user-roles',
    where: {
      and: [
        { user: { in: candidateIds } },
        { municipality: { equals: municipalityId } },
        { role: { in: ['municipality_admin', 'organizer'] } },
      ],
    },
    select: { user: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const withRole = new Set(roles.docs.map((r) => relationId(r.user)))
  return candidateIds.filter((id) => withRole.has(id))
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

/**
 * Takes a neighbouring obec co-organizing the event (Events neighbourObceOf) off it — the one way it
 * leaves, as any spolupořadatel does (EventDeletionRequests: the others agree, or the obec decides).
 * The event goes on without it. Pass the `req` of the transaction the request's own status change
 * runs in.
 */
export async function removeObecFromEvent(
  req: PayloadRequest,
  event: Pick<Event, 'id' | 'coOrganizations'>,
  municipalityId: number | string,
): Promise<Event> {
  const coOrganizationIds = (event.coOrganizations ?? []).map(relationId).filter((id): id is string => id !== null)
  const obec =
    coOrganizationIds.length > 0
      ? (
          await req.payload.find({
            collection: 'organizations',
            where: {
              and: [
                { id: { in: coOrganizationIds } },
                { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } },
                { municipality: { equals: municipalityId } },
              ],
            },
            select: {},
            depth: 0,
            limit: 1,
            overrideAccess: true,
            req,
          })
        ).docs[0]
      : undefined
  if (!obec) throw new APIError('Obec už akci nespolupořádá.', 409)
  return req.payload.update({
    collection: 'events',
    id: event.id,
    data: { coOrganizations: coOrganizationIds.filter((id) => id !== String(obec.id)).map(Number) },
    depth: 0,
    overrideAccess: true,
    context: { coOrganizerConsent: true },
    req,
  })
}

/** Tells everyone that a neighbouring obec left the event (removeObecFromEvent) — its admins and the
 * rest of the team, minus whoever decided. */
export async function announceObecRemoved(
  payload: Payload,
  { event, municipalityId, deciderId, byObec }: { event: Event; municipalityId: string; deciderId: string; byObec: boolean },
): Promise<void> {
  const municipality = await payload
    .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
    .catch(() => null)
  const name = municipality?.name ?? 'Obec'
  const link = `/akce/${event.id}`
  const reason = byObec
    ? 'Obec, kde se akce koná, vyhověla vaší žádosti'
    : 'Spolupořadatel nechce akci smazat, ale souhlasil, že ji vaše obec opustí'
  const admins = (await getMunicipalityAdminUserIds(payload, municipalityId)).filter((id) => String(id) !== deciderId)
  await sendNotificationToMany(payload, admins, {
    title: 'Obec akci už nespolupořádá',
    link,
    message: `${reason} — obec ${name} akci „${event.title}“ už nespolupořádá, pokračuje bez ní.`,
    email: {
      subject: `Obec akci už nespolupořádá: ${event.title}`,
      body: `<p>${escapeHtml(reason)} — obec ${escapeHtml(name)} akci <strong>${escapeHtml(event.title)}</strong> už nespolupořádá, pokračuje bez ní.</p>`,
    },
  })
  const team = await getEventTeamUserIds(payload, event, { exclude: [deciderId, ...admins] })
  await sendNotificationToMany(payload, team, {
    title: 'Změna pořadatelů akce',
    link,
    message: `Obec ${name} akci „${event.title}“ už nespolupořádá${byObec ? ' — rozhodla tak obec' : ''}.`,
  })
}
