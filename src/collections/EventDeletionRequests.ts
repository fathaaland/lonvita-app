import type {
  Access,
  Payload,
  PayloadRequest,
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import {
  actingNeighbourObec,
  deletionNeedsConsent,
  eventOrganizerIds,
  isEventCreator,
  neighbourObceOf,
  obecRole,
  runsByRegionRules,
} from './Events'
import { escapeHtml, getMunicipalityAdminUserIds, sendNotification } from './shared/notify'
import { canCancelEvent, eventCancellationDeadline, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { formatPragueDateTime } from '@/lib/date'
import type { EventDeletionRequest } from '@/payload-types'
import { relationId } from '@/lib/relations'
import { DELETION_CONSENT_HOURS } from '@/lib/requestDeadlines'

/** Still waiting on someone until `expiresAt` — the other organizers (`pending`), or the obec once
 * the requester turned to it after a refusal (`escalated`, `expiresAt` = the event's start). */
export const OPEN_STATUSES = ['pending', 'escalated']

/** The requester, whoever has to consent, the obec's admins and a platform admin. */
const canReadDeletionRequest: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const or: Where[] = [{ requestedBy: { equals: user.id } }, { approvers: { in: [user.id] } }]
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length > 0) {
    or.push(
      { municipality: { in: administeredIds } },
      // A neighbouring obec co-organizing the event — asking, or asked.
      { requesterMunicipality: { in: administeredIds } },
      { neighbourMunicipalities: { in: administeredIds } },
    )
  }
  const where: Where = { or }
  return where
}

/**
 * Everything about a new request is derived here from the event and the signed-in user — the
 * client only names the event. Only an organizer who runs it together with someone else may ask
 * (a sole organizer or the obec admin simply cancels it); everyone else on it has to consent — and
 * the obec, whenever it runs or co-organizes the event: any one of its admins answers for it, so
 * they aren't asked one by one.
 */
const prepareRequest: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data
  const { user, payload } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const eventId = relationId(data.event)
  const event = eventId
    ? await payload
        .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  if (!event || event.deletedAt) throw new APIError('Akce neexistuje nebo už byla zrušena.', 404)

  const organizerIds = eventOrganizerIds(event)
  // A neighbouring obec co-organizing the event asks for itself, like any spolupořadatel.
  const requesterMunicipality = organizerIds.includes(String(user.id))
    ? null
    : await actingNeighbourObec(req, user, event)
  if (!organizerIds.includes(String(user.id)) && !requesterMunicipality) {
    throw new APIError('O smazání akce může požádat jen její pořadatel nebo spolupořadatel.', 403)
  }
  if (!(await deletionNeedsConsent(req, user, event))) {
    throw new APIError('Tuhle akci můžete zrušit rovnou, souhlas nikoho dalšího nepotřebuje.', 400)
  }
  if (!canCancelEvent(event.dateTime)) {
    throw new APIError(`Akci lze smazat nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.`, 400)
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
    req,
  })
  if (open.docs.length > 0) throw new APIError('O smazání téhle akce už se rozhoduje.', 400)

  // Never past the cancellation cut-off — a consent arriving after it couldn't delete anything.
  const expiresAt = Math.min(
    Date.now() + DELETION_CONSENT_HOURS * 60 * 60 * 1000,
    eventCancellationDeadline(event.dateTime).getTime(),
  )

  const municipalityId = relationId(event.municipality)
  const { runs, coOrganizes } = await obecRole(req, event)
  const obecAdminIds = new Set(
    municipalityId && (runs || coOrganizes) ? (await getMunicipalityAdminUserIds(payload, municipalityId)).map(String) : [],
  )
  const neighbours = await obceWithAdmins(
    payload,
    (await neighbourObceOf(req, event)).filter((id) => id !== requesterMunicipality),
  )

  // In a mikroregion a spolupořadatel's organization asks only the event's creator — the pořadatel,
  // or the obec's admins when the obec runs it. It may leave the event on its own anyway
  // (api/events/[id]/leave). The pořadatel agreeing makes it their own request, which the rest of the
  // spolupořadatelé still consent to (the decide route) — two of them can't drop it on the others.
  const creatorOnly =
    !requesterMunicipality && !(await isEventCreator(req, user, event)) && (await runsByRegionRules(req, event))
  if (creatorOnly) {
    return {
      event: event.id,
      eventTitle: event.title,
      municipality: Number(municipalityId),
      requestedBy: user.id,
      requesterMunicipality: null,
      creatorOnly: true,
      approvers: runs ? [] : [Number(relationId(event.organizer))],
      neighbourMunicipalities: [],
      neighbourApproved: [],
      approvedBy: [],
      municipalityConsent: runs,
      municipalityApprovedBy: null,
      status: 'pending',
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  return {
    event: event.id,
    eventTitle: event.title,
    municipality: municipalityId ? Number(municipalityId) : null,
    requestedBy: user.id,
    requesterMunicipality: requesterMunicipality ? Number(requesterMunicipality) : null,
    creatorOnly: false,
    approvers: organizerIds.filter((id) => id !== String(user.id) && !obecAdminIds.has(id)).map(Number),
    neighbourMunicipalities: neighbours.map(Number),
    neighbourApproved: [],
    approvedBy: [],
    municipalityConsent: runs || coOrganizes,
    municipalityApprovedBy: null,
    status: 'pending',
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

/**
 * Asks everyone whose consent the request waits for — the users among `approvers`, each neighbouring
 * obec and the event's obec (any one of their admins answering for it). An obec without an admin is
 * answered for by the platform admins (deciderIdsForObec), so no consent waits on nobody. `lead` names
 * who asks — "Jana Nováková", or "Pořadatel Petr Novák souhlasí se žádostí Jany Novákové".
 */
export async function askForDeletionConsent(
  payload: Payload,
  doc: EventDeletionRequest,
  lead: string,
  req?: PayloadRequest,
): Promise<void> {
  const until = formatPragueDateTime(doc.expiresAt)
  const eventId = relationId(doc.event)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const ask = async (userIds: (number | string)[], whose: string, consent: string) => {
    for (const userId of userIds) {
      await sendNotification(payload, {
        userId,
        title: 'Žádost o smazání akce',
        link: `/akce/${eventId}`,
        message: `${lead} chce smazat akci „${doc.eventTitle}“, ${whose}. Bez ${consent} se nesmaže — odpovězte do ${until}.`,
        email: {
          subject: `Žádost o smazání akce: ${doc.eventTitle}`,
          body:
            `<p><strong>${escapeHtml(lead)}</strong> chce smazat akci <strong>${escapeHtml(doc.eventTitle)}</strong>, ${whose}.</p>` +
            `<p>Bez ${consent} se akce nesmaže. Odpovědět můžete do ${until} — když nikdo neodpoví, akce zůstane.</p>` +
            `<p><a href="${appUrl}/akce/${eventId}">Otevřít akci a rozhodnout</a></p>`,
        },
      })
    }
  }

  for (const neighbourId of ((doc.neighbourMunicipalities ?? []) as unknown[]).map(relationId)) {
    if (neighbourId) {
      await ask(await deciderIdsForObec(payload, neighbourId, req), 'kterou vaše obec spolupořádá', 'souhlasu obce')
    }
  }
  if (doc.municipalityConsent && relationId(doc.municipality)) {
    await ask(await deciderIdsForObec(payload, relationId(doc.municipality)!, req), 'kterou obec pořádá', 'souhlasu obce')
  }
  await ask(
    ((doc.approvers ?? []) as unknown[]).map(relationId).filter((id): id is string => id !== null),
    'kterou spolu pořádáte',
    'vašeho souhlasu',
  )
}

/** The obce that have an admin to answer for them. A neighbouring obec without one has no say in a
 * deletion request — nobody could give it, and the event can't be held hostage to that. */
export async function obceWithAdmins(payload: Payload, municipalityIds: string[]): Promise<string[]> {
  const result: string[] = []
  for (const id of municipalityIds) if ((await getMunicipalityAdminUserIds(payload, id)).length > 0) result.push(id)
  return result
}

/** Who answers a deletion request for an obec — its admins, or the platform admins while it has none. */
export async function deciderIdsForObec(
  payload: Payload,
  municipalityId: number | string,
  req?: PayloadRequest,
): Promise<string[]> {
  const admins = await getMunicipalityAdminUserIds(payload, municipalityId)
  if (admins.length > 0) return admins.map(String)
  const platformAdmins = await payload.find({
    collection: 'users',
    where: { role: { equals: 'admin' } },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return platformAdmins.docs.map((u) => String(u.id))
}

const notifyApprovers: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc

  const requesterId = relationId(doc.requestedBy)!
  const profile = await req.payload.find({
    collection: 'profiles',
    where: { user: { equals: requesterId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  const requesterObec = relationId(doc.requesterMunicipality)
    ? await req.payload
        .findByID({ collection: 'municipalities', id: relationId(doc.requesterMunicipality)!, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  const name = profile.docs[0]?.fullName || 'Spolupořadatel'
  await askForDeletionConsent(req.payload, doc, requesterObec ? `${name} za obec ${requesterObec.name}` : name, req)
  return doc
}

/** An open request past its `expiresAt` reads back as "expired" straight away, like Events'
 * deriveFinishedStatus; the worker's sync-statuses job writes it down. The event is left as it was. */
const deriveExpiredStatus: CollectionAfterReadHook = ({ doc }) => {
  if (!OPEN_STATUSES.includes(doc.status) || new Date(doc.expiresAt).getTime() > Date.now()) return doc
  return { ...doc, status: 'expired' }
}

/**
 * Two organizers running an event together must both agree before it's deleted: one asks, the
 * others (and the obec, if it runs or co-organizes it) get notified and have DELETION_CONSENT_HOURS to
 * answer (api/events/deletion-requests/[id]/decide):
 * - all consent → the event is hard-deleted (`approved`);
 * - one keeps the event but lets the requester go → the requester leaves it, the event stays with
 *   the rest — handed over to whoever chose so, if the requester was its pořadatel
 *   (`requester-removed`);
 * - one refuses, or time runs out → everything stays (`rejected` / `expired`).
 * After a spolupořadatel's refusal — or when nobody answered in time — the requester may turn to the
 * obec (…/escalate → `escalated`, open until the event starts), whose admin takes them off the event
 * without the others' consent (`requester-removed`) or turns it down (`escalation-rejected`) —
 * …/municipality-decide. Created over REST; decided only
 * through those routes (update is closed here).
 */
export const EventDeletionRequests: CollectionConfig = {
  slug: 'event-deletion-requests',
  labels: {
    singular: 'Event Deletion Request',
    plural: 'Event Deletion Requests',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['eventTitle', 'requestedBy', 'status', 'expiresAt'],
  },
  access: {
    read: canReadDeletionRequest,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      // Not `required`: once approved the event is hard-deleted and this goes null (the row stays
      // as history, with eventTitle below).
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
    },
    {
      name: 'eventTitle',
      type: 'text',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
    },
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      // Set when an admin asks for a neighbouring obec co-organizing the event — the obec, not the
      // admin, is the spolupořadatel asking (and leaving, if the others let it go).
      name: 'requesterMunicipality',
      type: 'relationship',
      relationTo: 'municipalities',
    },
    {
      // A spolupořadatel's organization asked in a mikroregion — only the event's creator was asked.
      // Their consent turns it into their own request to the rest (the decide route).
      name: 'creatorOnly',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'approvers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      admin: { description: 'Everyone else organizing the event — all of them have to consent.' },
    },
    {
      // Neighbouring obce co-organizing the event (Events neighbourObceOf) — each has to consent,
      // any one of its admins for it.
      name: 'neighbourMunicipalities',
      type: 'relationship',
      relationTo: 'municipalities',
      hasMany: true,
    },
    {
      name: 'neighbourApproved',
      type: 'relationship',
      relationTo: 'municipalities',
      hasMany: true,
      admin: { description: 'The neighbouring obce that have consented.' },
    },
    {
      // The obec co-organizes the event — one of its admins has to consent on its behalf too.
      name: 'municipalityConsent',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'municipalityApprovedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'The obec admin who consented for the obec.' },
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved (event deleted)', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Expired', value: 'expired' },
        { label: 'Requester removed (event kept)', value: 'requester-removed' },
        { label: 'Escalated to the obec', value: 'escalated' },
        { label: 'Rejected by the obec', value: 'escalation-rejected' },
      ],
    },
    {
      // The others' answer deadline; once escalated, the event's start (the obec's deadline).
      name: 'expiresAt',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'rejectedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description:
          'The organizer who refused (or the admin of a neighbouring obec, for it) — if the obec then takes the pořadatel off, the event passes to the organizer.',
      },
    },
    {
      name: 'escalatedAt',
      type: 'date',
      admin: { description: 'When the requester turned to the obec after the refusal.' },
    },
    {
      name: 'successor',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Who took the event over when the requester leaving it was its pořadatel.' },
    },
    {
      name: 'decidedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
    },
    {
      name: 'decidedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
  ],
  hooks: {
    beforeValidate: [prepareRequest],
    afterChange: [notifyApprovers],
    afterRead: [deriveExpiredStatus],
  },
  timestamps: true,
}
