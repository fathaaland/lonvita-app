import type {
  Access,
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeOperationHook,
  CollectionConfig,
  FieldHook,
  PayloadRequest,
  Where,
} from 'payload'
import { APIError } from 'payload'

import {
  getAdministeredMunicipalityIds,
  getOrganizerMunicipalityIds,
} from './access/shared'
import { ensureMunicipalityOrganization, findOrganizationId, municipalityOrganizationIds } from './Organizations'
import { auditDeletion, writeAuditLog } from './shared/auditLog'
import { notDeleted } from './shared/softDelete'
import { escapeHtml, getEventTeamUserIds, getMunicipalityAdminUserIds, sendNotification, sendNotificationToMany } from './shared/notify'
import { scheduleAttendanceReminder } from './shared/reminders'
import { guardCancellationWindow, sealCancellation } from './shared/eventCancellation'
import {
  NOTIFIABLE_EDIT_FIELDS,
  changedNotifiableFields,
  comparable,
  notifyEventCancelled,
  queueEventUpdatedNotification,
  snapshotNotifiableFields,
} from './shared/eventNotifications'
import { MULTI_DAY_END_MESSAGE, pragueDateKey } from '@/lib/date'
import { hasEventEnded } from '@/lib/eventEnded'
import { haversineDistanceKm } from '@/lib/geo/distance'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

import type { Event } from '@/payload-types'
import { relationId } from '@/lib/relations'

/**
 * Brief §3 "Pravidla pro vznik akcí" — a municipality picks one of two modes
 * (Municipalities.rulesForCreation). A signed-out visitor is always read-only regardless.
 *
 * Task 5 (security): there used to be an "anyone logged in may create" mode, which meant a
 * municipality_admin of one obec could create events in a *different* obec simply by being a
 * logged-in user, if that other obec opted into it. That mode is gone — a user with no
 * administered/organizer relationship to a municipality can never create events there, full stop.
 */
const canCreateEvent: Access = async ({ req, data }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true
  if (!data?.municipality) return false

  const municipalityId = String(
    typeof data.municipality === 'object' ? data.municipality.id : data.municipality,
  )

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.includes(municipalityId)) return true

  const municipality = await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
  })
  const rule = municipality?.rulesForCreation ?? 'approved_organizers'

  if (rule === 'municipality_only') return false

  const organizerIds = await getOrganizerMunicipalityIds(payload, user.id)
  return organizerIds.includes(municipalityId)
}

export type EventOwnership = {
  id: number | string
  organizer?: unknown
  organization?: unknown
  coOrganizations?: unknown[] | null
  coOrganizers?: unknown[] | null
  municipality?: unknown
}

/** Everyone organizing the event — the pořadatel plus the spolupořadatelé. */
export const eventOrganizerIds = (event: Pick<EventOwnership, 'organizer' | 'coOrganizers'>): string[] => [
  ...new Set(
    [event.organizer, ...(event.coOrganizers ?? [])].map(relationId).filter((id): id is string => id !== null),
  ),
]

/** The user's administered obce, looked up once per request — the event access check and both
 * viewer fields below all need it. */
export async function administeredIdsFor(req: PayloadRequest, userId: number | string): Promise<string[]> {
  const key = `administeredMunicipalityIds:${userId}`
  const cached = req.context?.[key] as string[] | undefined
  if (cached) return cached
  const ids = await getAdministeredMunicipalityIds(req.payload, Number(userId))
  if (req.context) req.context[key] = ids
  return ids
}

/** Whether the event is run by its obec (the obec's organization is its `organization`) and
 * whether the obec co-organizes it (among its `coOrganizations`). */
export async function obecRole(
  req: PayloadRequest,
  event: EventOwnership,
): Promise<{ runs: boolean; coOrganizes: boolean }> {
  const municipalityId = relationId(event.municipality)
  if (!municipalityId) return { runs: false, coOrganizes: false }
  const obecOrganizationId = (await municipalityOrganizationIds(req, [municipalityId])).get(municipalityId)
  if (!obecOrganizationId) return { runs: false, coOrganizes: false }
  return {
    runs: relationId(event.organization) === obecOrganizationId,
    coOrganizes: ((event.coOrganizations ?? []) as unknown[]).map(relationId).includes(obecOrganizationId),
  }
}

/**
 * Whether `user` decides what's the event creator's alone — its attendance, its volunteers (the
 * flag, inviting them, their offers, their ratings) and the complaints about its reviews: the
 * pořadatel who founded it, or — when the obec runs it — any of the obec's admins, who answer for
 * the obec together; and a platform admin. Not its spolupořadatelé, nor the obec when it merely
 * co-organizes someone else's event.
 */
export async function isEventCreator(
  req: PayloadRequest,
  user: { id: number | string; role?: string | null },
  event: Pick<EventOwnership, 'organizer' | 'organization' | 'municipality'>,
): Promise<boolean> {
  if (user.role === 'admin' || relationId(event.organizer) === String(user.id)) return true
  const municipalityId = relationId(event.municipality)
  if (!municipalityId || !(await administeredIdsFor(req, user.id)).includes(municipalityId)) return false
  return (await obecRole(req, { id: 0, ...event })).runs
}

/** Who the event's creator is, as people to notify: the obec's admins when the obec runs it, its
 * pořadatel otherwise (isEventCreator). */
export async function eventCreatorUserIds(
  req: PayloadRequest,
  event: Pick<EventOwnership, 'organizer' | 'organization' | 'municipality'>,
): Promise<string[]> {
  const municipalityId = relationId(event.municipality)
  if (municipalityId && (await obecRole(req, { id: 0, ...event })).runs) {
    const adminIds = await getMunicipalityAdminUserIds(req.payload, municipalityId)
    if (adminIds.length > 0) return adminIds.map(String)
  }
  const organizerId = relationId(event.organizer)
  return organizerId ? [organizerId] : []
}

/**
 * Readable events. Everyone — signed-out visitors too — sees every published event (brief §2). A
 * draft (isDraft) is its creator's alone — and a platform admin's: not the obec's admins, not
 * anybody else, link or not. A published event's team, its obec's admins and whoever is signed up
 * read it as before.
 */
const canReadEvent: Access = async ({ req }) => {
  const { user, payload } = req
  if (user?.role === 'admin') return notDeleted
  const published: Where = { isDraft: { not_equals: true } }
  if (!user) return { and: [notDeleted, published] }

  const key = `hiddenEventsReadableBy:${user.id}`
  let or = req.context?.[key] as Where[] | undefined
  if (!or) {
    const [administeredIds, registrations] = await Promise.all([
      administeredIdsFor(req, user.id),
      payload.find({
        collection: 'registrations',
        where: { and: [{ user: { equals: user.id } }, { status: { in: ['pending', 'approved'] } }] },
        select: { event: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
    ])
    or = [published, { organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }]
    if (administeredIds.length > 0) or.push({ and: [published, { municipality: { in: administeredIds } }] })
    const signedUpFor = registrations.docs.map((r) => relationId(r.event)).filter((id): id is string => Boolean(id))
    if (signedUpFor.length > 0) or.push({ id: { in: signedUpFor } })
    if (req.context) req.context[key] = or
  }
  return { and: [notDeleted, { or }] }
}

/** Events that haven't taken place yet — the where-form of hasEventEnded. */
export const notYetEnded = (): Where => {
  const now = new Date().toISOString()
  return {
    or: [
      { endDateTime: { greater_than_equal: now } },
      { and: [{ endDateTime: { exists: false } }, { dateTime: { greater_than_equal: now } }] },
    ],
  }
}

/** Brief §4 organizer self-service edit of their own event — everyone organizing it (the pořadatel
 * and every spolupořadatel, the obec on it or not), a municipality admin for any event in their obec,
 * and a platform admin everywhere. Cancelling an event several organizers run needs the others'
 * consent (guardCoOrganizedChanges). Moving an event to another obec or handing it to another
 * organizer stays platform-admin-only (field access below). A cancelled event is closed for good,
 * and one that has taken place is nobody's to edit any more — a platform admin's neither. Trusted
 * internal writes (overrideAccess) — e.g. flipping status to "full" — bypass this as usual. */
const canUpdateEvent: Access = async ({ req }) => {
  const { user } = req
  if (!user) return false
  const open: Where[] = [notYetEnded(), notDeleted, { status: { not_equals: 'cancelled' } }]
  if (user.role === 'admin') return { and: open }

  const administeredIds = await administeredIdsFor(req, user.id)
  const or: Where[] = [{ organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }]
  // Not someone's draft — that's theirs until they publish it.
  if (administeredIds.length > 0)
    or.push({ and: [{ isDraft: { not_equals: true } }, { municipality: { in: administeredIds } }] })
  const where: Where = { and: [...open, { or }] }
  return where
}

/** The single-event form of canUpdateEvent: whether `user` may edit `event` — and so invite
 * organizations to co-organize it (CoOrganizingRequests). */
export async function mayEditEvent(
  req: PayloadRequest,
  user: { id: number | string; role?: string | null },
  event: EventOwnership & { dateTime: string; endDateTime?: string | null },
): Promise<boolean> {
  if (hasEventEnded(event.dateTime, event.endDateTime)) return false
  if (user.role === 'admin' || eventOrganizerIds(event).includes(String(user.id))) return true
  return (await administeredIdsFor(req, user.id)).includes(relationId(event.municipality) ?? '')
}

/** Whether `user` must go through an EventDeletionRequest (the others' consent) rather than
 * cancel the event outright: they organize it together with another organizer, or with the obec,
 * and aren't an admin of its obec (who may always cancel). */
export async function deletionNeedsConsent(
  req: PayloadRequest,
  user: { id: number | string; role?: string | null },
  event: EventOwnership,
): Promise<boolean> {
  if (user.role === 'admin') return false
  const organizerIds = eventOrganizerIds(event)
  if (!organizerIds.includes(String(user.id))) return false
  const administeredIds = await administeredIdsFor(req, user.id)
  if (administeredIds.includes(relationId(event.municipality) ?? '')) return false
  return organizerIds.length >= 2 || (await obecRole(req, event)).coOrganizes
}

/**
 * Two organizers running an event together can both edit it, but neither can drop it on the
 * other: cancelling needs the other's consent, via an EventDeletionRequest (its decide route is
 * the one trusted path, `context.coOrganizerConsent`). For the same reason an organizer can't take a
 * spolupořadatel off — not even themselves, nor the obec: leaving goes through an
 * EventDeletionRequest too (the others agree to it, or the obec decides), which takes them off with
 * that same context, and the obec steps off on its own (ObecLeave). The obec's admins and a
 * platform admin are exempt from all of it.
 */
const guardCoOrganizedChanges: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (operation !== 'update' || !data || !originalDoc || !req.user) return data
  if (req.context?.coOrganizerConsent) return data

  const cancelling =
    (data.deletedAt && !originalDoc.deletedAt) || (data.status === 'cancelled' && originalDoc.status !== 'cancelled')
  if (cancelling && (await deletionNeedsConsent(req, req.user, originalDoc))) {
    throw new APIError(
      'Akci pořádáte společně se spolupořadateli — smazat ji jde jen s jejich souhlasem. Pošlete jim žádost o smazání.',
      400,
    )
  }

  // By organization, not owner — the obec's own organization has none.
  if (data.coOrganizations && req.user.role !== 'admin') {
    const administeredIds = await administeredIdsFor(req, req.user.id)
    if (!administeredIds.includes(relationId(originalDoc.municipality) ?? '')) {
      const kept = new Set((data.coOrganizations as unknown[]).map(relationId))
      const removed = ((originalDoc.coOrganizations ?? []) as unknown[])
        .map(relationId)
        .filter((id) => id !== null && !kept.has(id))
      if (removed.length > 0) {
        throw new APIError(
          'Spolupořadatele z akce odebrat nemůžete — z akce se odchází jen přes žádost o smazání (se souhlasem ostatních, nebo rozhodnutím obce). Přímo spolupořadatele — i obec — odebere jen admin obce.',
          400,
        )
      }
    }
  }

  return data
}

/**
 * A hard DELETE takes the registrations along without telling anyone — so an event that hasn't
 * taken place is cancelled first (the PATCH above, which announces it and keeps the cut-off before
 * the start), and only then, or once it's over, deleted. Only when access control applies (every
 * REST request): the organizers' consented deletion and deleting the obec announce it themselves.
 */
const guardUpcomingDelete: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'delete') return args
  const { id, where, overrideAccess } = args as { id?: number | string; where?: Where; overrideAccess?: boolean }
  if (overrideAccess !== false || !req.user) return args

  const upcoming = await req.payload.count({
    collection: 'events',
    where: {
      and: [
        id !== undefined ? { id: { equals: id } } : (where ?? {}),
        notDeleted,
        { status: { not_equals: 'cancelled' } },
        // A draft has nobody to tell — it's simply deleted.
        { isDraft: { not_equals: true } },
        notYetEnded(),
      ],
    },
    overrideAccess: true,
    req,
  })
  if (upcoming.totalDocs > 0) {
    throw new APIError(
      'Akci, která ještě neproběhla, nejdřív zrušte — přihlášení dostanou zprávu. Smazat ji jde až potom.',
      409,
    )
  }
  return args
}

/** Platform/municipality admin everywhere they administer — a hard DELETE isn't part of the
 * organizer's self-service (cancelling is the soft-delete PATCH above). Their own draft its creator
 * deletes themselves. */
const canDeleteEvent: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const ownDraft: Where = { and: [{ organizer: { equals: user.id } }, { isDraft: { equals: true } }] }
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length === 0) return ownDraft
  const where: Where = {
    or: [ownDraft, { and: [{ isDraft: { not_equals: true } }, { municipality: { in: administeredIds } }] }],
  }
  return where
}

/** The event's creator, and a platform admin, decide whether it's a draft — nobody else sees one. */
const isCreatorOrPlatformAdmin = ({ req, doc }: { req: PayloadRequest; doc?: { organizer?: unknown } }) =>
  req.user?.role === 'admin' || (Boolean(req.user) && relationId(doc?.organizer) === String(req.user!.id))

/**
 * Back to a draft only while nobody is on the event yet — no participant, no volunteer (signed up or
 * invited), no spolupořadatel: once anyone is, it stays published (cancelling stays). */
const guardBackToDraft: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (operation !== 'update' || !data || !originalDoc) return data
  if (!data.isDraft || originalDoc.isDraft) return data
  if (originalDoc.status === 'cancelled') throw new APIError('Zrušenou akci do konceptu vrátit nejde.', 409)
  const eventId = originalDoc.id
  const [registrations, invitations] = await Promise.all([
    req.payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: eventId } }, { status: { in: ['pending', 'approved'] } }] },
      overrideAccess: true,
      req,
    }),
    req.payload.count({
      collection: 'volunteer-invitations',
      where: { and: [{ event: { equals: eventId } }, { status: { in: ['pending', 'accepted'] } }] },
      overrideAccess: true,
      req,
    }),
  ])
  const coOrganized =
    (originalDoc.coOrganizers ?? []).length > 0 || (originalDoc.coOrganizations ?? []).length > 0
  if (registrations.totalDocs > 0 || invitations.totalDocs > 0 || coOrganized) {
    throw new APIError(
      'Na akci už jsou přihlášení, dobrovolníci nebo spolupořadatelé — do konceptu ji vrátit nejde. Zbývá ji zrušit.',
      409,
    )
  }
  return data
}

const platformAdminOnly = ({ req: { user } }: { req: { user: { role?: string } | null } }) => user?.role === 'admin'

/** Whether a volunteer has signed up for the event — offered to help (still waiting on the creator),
 * or is on it (an accepted offer or invitation). From then on the event stays a volunteering one. */
export async function hasVolunteersSignedUp(req: PayloadRequest, eventId: number | string): Promise<boolean> {
  const [onEvent, offers] = await Promise.all([
    req.payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: eventId } }, { role: { equals: 'volunteer' } }, { status: { in: ['pending', 'approved'] } }] },
      overrideAccess: true,
      req,
    }),
    req.payload.count({
      collection: 'volunteer-invitations',
      where: { and: [{ event: { equals: eventId } }, { kind: { equals: 'application' } }, { status: { equals: 'pending' } }] },
      overrideAccess: true,
      req,
    }),
  ])
  return onEvent.totalDocs + offers.totalDocs > 0
}

/**
 * The volunteering flag is the event creator's alone (isEventCreator) — they mark their event as one
 * for volunteers themselves, no obec approval needed, also later on, before it takes place. Not a
 * spolupořadatel's, not the obec's — unless the obec runs the event, when its admins are the
 * creator. A platform admin may always, and so may trusted internal writes (no user). Anyone else's
 * attempt is dropped. Once a volunteer has signed up (hasVolunteersSignedUp) the mark stays — nobody
 * takes it off.
 */
const guardIsVolunteering: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data || data.isVolunteering === undefined) return data
  if (data.isVolunteering === Boolean(originalDoc?.isVolunteering)) return data

  const { user } = req
  if (!user) return data

  // resolveOrganizations has already set a new event's `organization`.
  const event = {
    organizer: data.organizer ?? originalDoc?.organizer,
    organization: data.organization !== undefined ? data.organization : originalDoc?.organization,
    municipality: data.municipality ?? originalDoc?.municipality,
  }
  if (!(await isEventCreator(req, user, event))) {
    data.isVolunteering = originalDoc?.isVolunteering ?? false
    return data
  }

  if (!data.isVolunteering && originalDoc?.id && (await hasVolunteersSignedUp(req, originalDoc.id))) {
    throw new APIError('Na akci se už přihlásil dobrovolník — označení dobrovolnické akce už odebrat nejde.', 400)
  }

  return data
}

/**
 * An event is always filed under someone who actually organizes in that obec — its organizer
 * holds "municipality_admin" or "organizer" there. `canCreateEvent` covers that for anyone
 * creating their own event, but it lets a platform superadmin straight through, and the
 * superadmin panel passes `organizer` explicitly — so a plain účastník could be made pořadatel
 * of an obec's event without ever getting the role. Enforced on create, and on update only when
 * the organizer or the obec actually changes, so editing an older event whose organizer has
 * since lost the role keeps working.
 */
const requireOrganizerRole: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (!data) return data

  const organizerId = relationId(data.organizer ?? originalDoc?.organizer)
  const municipalityId = relationId(data.municipality ?? originalDoc?.municipality)
  if (!organizerId || !municipalityId) return data

  if (
    operation === 'update' &&
    relationId(originalDoc?.organizer) === organizerId &&
    relationId(originalDoc?.municipality) === municipalityId
  ) {
    return data
  }

  const roles = await req.payload.find({
    collection: 'user-roles',
    where: {
      and: [
        { user: { equals: organizerId } },
        { municipality: { equals: municipalityId } },
        { role: { in: ['municipality_admin', 'organizer'] } },
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })

  if (roles.docs.length === 0) {
    throw new APIError(
      'Vybraný pořadatel nemá v téhle obci roli „Admin obce“ ani „Organizátor“. Nejdřív mu roli přiřaďte, teprve potom pro něj lze akci vytvořit.',
      400,
    )
  }

  return data
}

/**
 * Spolupořadatelé are organizations of the same obec (Organizations.ts) — "Kavárna NMNM", not its
 * owner, or the obec's own organization. Nobody becomes one without their own consent: whoever may
 * edit the event invites an organization (CoOrganizingRequests), and it joins once its owner — for
 * the obec, one of its admins — accepts. That acceptance is the one trusted path that adds one,
 * `context.coOrganizingApproved`; taking one off is the obec's call or goes through an
 * EventDeletionRequest (guardCoOrganizedChanges). Trusted internal writes (no user — seeds, scripts) pass as always.
 * From the organizations this derives the rest of the event's ownership:
 * - `organization` — what the pořadatel runs it as: their own organization in the obec, or the
 *   obec's when they're its admin (it's the obec's event — see isEventCreator);
 * - `coOrganizers` — the organizations' owners, the users every ownership check (canUpdateEvent,
 *   deletion consent, Registrations) works with. The obec's organization has no
 *   owner; its admins get at the event through their obec anyway.
 * Only newly added organizations are checked (all of them, if the event moves to another obec), so
 * editing an event whose spolupořadatel has since lost the role keeps working. Once the obec has
 * stepped off the event (`obecLeftAt`), it never comes back to it.
 */
const resolveOrganizations: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (!data) return data

  const organizerId = relationId(data.organizer ?? originalDoc?.organizer)
  const municipalityId = relationId(data.municipality ?? originalDoc?.municipality)
  if (!organizerId || !municipalityId) return data

  const municipalityChanged = operation === 'update' && relationId(originalDoc?.municipality) !== municipalityId
  const organizerChanged = operation === 'update' && relationId(originalDoc?.organizer) !== organizerId
  if (operation === 'create' || municipalityChanged || organizerChanged) {
    const organizerIsObecAdmin = (await getAdministeredMunicipalityIds(req.payload, Number(organizerId))).includes(
      municipalityId,
    )
    data.organization = organizerIsObecAdmin
      ? await ensureMunicipalityOrganization(req, municipalityId)
      : await findOrganizationId(req, organizerId, municipalityId)
  }
  const eventOrganizationId = relationId(data.organization !== undefined ? data.organization : originalDoc?.organization)

  if (operation === 'create' && !data.coOrganizations) data.coOrganizations = []
  if (!data.coOrganizations) return data

  const ids = [
    ...new Set((data.coOrganizations as unknown[]).map(relationId).filter((id): id is string => id !== null)),
  ]
  const previousIds = new Set(
    operation === 'update' && !municipalityChanged
      ? ((originalDoc?.coOrganizations ?? []) as unknown[]).map(relationId)
      : [],
  )
  const organizations =
    ids.length > 0
      ? (
          await req.payload.find({
            collection: 'organizations',
            where: { id: { in: ids } },
            depth: 0,
            pagination: false,
            overrideAccess: true,
            req,
          })
        ).docs
      : []
  const byId = new Map(organizations.map((o) => [String(o.id), o]))

  // The obec stepping off the event (ObecLeave route, or its admin in the form) is for good.
  if (operation === 'update' && !municipalityChanged && !originalDoc?.obecLeftAt) {
    const obecOrganizationId = (await municipalityOrganizationIds(req, [municipalityId])).get(municipalityId)
    if (obecOrganizationId && previousIds.has(obecOrganizationId) && !ids.includes(obecOrganizationId)) {
      data.obecLeftAt = new Date().toISOString()
    }
  }
  const obecLeft = !municipalityChanged && Boolean(data.obecLeftAt ?? originalDoc?.obecLeftAt)

  const addedOwnerIds: string[] = []
  for (const id of ids) {
    const organization = byId.get(id)
    const added = !previousIds.has(id)
    if (!organization || (added && (organization.deletedAt || relationId(organization.municipality) !== municipalityId))) {
      throw new APIError('Spolupořadatelem může být jen organizace z téhle obce.', 400)
    }
    if (organization.type === MUNICIPALITY_ORGANIZATION_TYPE) {
      if (id === eventOrganizationId) {
        throw new APIError('Akci už pořádá obec — za spolupořadatele ji přidat nejde.', 400)
      }
      if (added && obecLeft) {
        throw new APIError('Obec spolupořádání téhle akce ukončila — vrátit se k ní už nejde.', 400)
      }
    } else {
      const ownerId = relationId(organization.owner)!
      if (ownerId === organizerId || id === eventOrganizationId) {
        throw new APIError('Vlastní organizaci nelze přidat jako spolupořadatele — akci už pořádáte.', 400)
      }
      if (added) addedOwnerIds.push(ownerId)
    }
    if (added && req.user && !req.context?.coOrganizingApproved) {
      throw new APIError(
        'Spolupořadatele nejde přidat přímo — pošlete organizaci pozvánku. Spolupořadatelem se stane, až ji přijme.',
        400,
      )
    }
  }

  if (addedOwnerIds.length > 0) {
    const roles = await req.payload.find({
      collection: 'user-roles',
      where: {
        and: [
          { user: { in: addedOwnerIds } },
          { municipality: { equals: municipalityId } },
          { role: { equals: 'organizer' } },
        ],
      },
      depth: 0,
      limit: 500,
      overrideAccess: true,
      req,
    })
    const withRole = new Set(roles.docs.map((r) => relationId(r.user)))
    if (addedOwnerIds.some((id) => !withRole.has(id))) {
      throw new APIError('Tahle organizace už v obci nepořádá — její pořadatel nemá roli organizátora.', 400)
    }
  }

  data.coOrganizations = ids.map(Number)
  data.coOrganizers = [
    ...new Set(ids.map((id) => relationId(byId.get(id)!.owner)).filter((id): id is string => id !== null)),
  ].map(Number)
  return data
}

/** An event created from an imported candidate (lib/import/approve) remembers where it was taken
 * from — set from the approval's own `context`, never from the client. */
const stampImportedFrom: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create' || !data) return data
  const importedFrom = req.context?.importedFrom
  data.importedFrom = typeof importedFrom === 'string' && /^https?:\/\//.test(importedFrom) ? importedFrom : null
  return data
}

/** Only resolved for a signed-in viewer — the administered obce it needs are looked up once per
 * request, and the obec's organization only for an admin of the event's obec. */
const resolveCreatorForViewer: FieldHook = async ({ req, siblingData }) => {
  const { user } = req
  if (!user || !siblingData?.id) return false
  return isEventCreator(req, user, siblingData as EventOwnership)
}

const resolveDeletionNeedsConsent: FieldHook = async ({ req, siblingData }) => {
  const { user } = req
  if (!user || !siblingData?.id) return false
  return deletionNeedsConsent(req, user, siblingData as EventOwnership)
}

/** Only resolved for whoever may set the flag (the creator, a platform admin) on a volunteering
 * event — so a public listing doesn't pay for the lookup per event. */
const resolveVolunteeringLocked: FieldHook = async ({ req, siblingData }) => {
  const { user } = req
  if (!user || !siblingData?.id || !siblingData.isVolunteering) return false
  if (!(await isEventCreator(req, user, siblingData as EventOwnership))) return false
  return hasVolunteersSignedUp(req, siblingData.id)
}

/** A new event can't start in the past, and neither can one that gets rescheduled — but the
 * start is only checked when it actually changes, so editing e.g. the title of an event that is
 * already running (or over) keeps working. A multi-day event ends on a later day than it starts. */
const validateEventDates: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (!data) return data

  const start = data.dateTime ?? originalDoc?.dateTime
  const end = data.endDateTime === undefined ? originalDoc?.endDateTime : data.endDateTime
  if (!start) return data

  const startMs = new Date(start).getTime()
  const startChanged =
    operation === 'create' || (originalDoc?.dateTime && startMs !== new Date(originalDoc.dateTime).getTime())

  if (startChanged && startMs < Date.now()) {
    throw new APIError('Akce nemůže začínat v minulosti. Vyberte prosím budoucí datum a čas.', 400)
  }
  if (end && new Date(end).getTime() < startMs) {
    throw new APIError('Konec akce nemůže být dřív než její začátek.', 400)
  }
  // Only when the dates move — an older event saved with a same-day end stays editable.
  const msOf = (iso: unknown) => (iso ? new Date(iso as string).getTime() : null)
  const endChanged =
    operation === 'create' || (data.endDateTime !== undefined && msOf(data.endDateTime) !== msOf(originalDoc?.endDateTime))
  if (end && (startChanged || endChanged) && pragueDateKey(end) <= pragueDateKey(start)) {
    throw new APIError(MULTI_DAY_END_MESSAGE, 400)
  }

  return data
}

/**
 * The location an event is created/edited at must actually be near the obec it's filed
 * under — otherwise an admin obce (or organizer) could plant an event anywhere and have it
 * show up on a completely unrelated municipality's page. Bounded by that municipality's own
 * configurable `eventRadiusKm` (Municipalities.ts) rather than a fixed constant, since a
 * small village and a big city need very different radii. Applies to every creator alike
 * (admin or organizer) — this is a data-integrity check, not a role check.
 */
const validateEventLocationRadius: CollectionBeforeChangeHook = async ({ data, req, originalDoc, operation }) => {
  if (!data) return data
  // Only when the place or the obec changes — an event that predates a smaller radius (or a moved
  // obec centre) stays editable, and so cancellable, where it is.
  const moved =
    operation === 'create' ||
    (data.lat !== undefined && data.lat !== originalDoc?.lat) ||
    (data.lng !== undefined && data.lng !== originalDoc?.lng) ||
    (data.municipality !== undefined && relationId(data.municipality) !== relationId(originalDoc?.municipality))
  if (!moved) return data

  const lat = data.lat ?? originalDoc?.lat
  const lng = data.lng ?? originalDoc?.lng
  const municipalityRaw = data.municipality ?? originalDoc?.municipality
  if (typeof lat !== 'number' || typeof lng !== 'number' || !municipalityRaw) return data

  const municipalityId = typeof municipalityRaw === 'object' ? municipalityRaw.id : municipalityRaw

  const municipality = await req.payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
  })
  if (!municipality) return data

  const radiusKm = municipality.eventRadiusKm ?? 15
  const distanceKm = haversineDistanceKm(lat, lng, municipality.lat, municipality.lng)

  if (distanceKm > radiusKm) {
    // status 400 (not the default 500) makes Payload treat this as a *public* error — a plain
    // `throw new Error()` here would otherwise get masked to a generic "Something went wrong"
    // over REST (see isErrorPublic.js), which would make this check impossible to act on from the UI.
    throw new APIError(
      `Místo konání je ${distanceKm.toFixed(1)} km od obce „${municipality.name}“, což přesahuje povolený okruh ${radiusKm} km. Vyberte místo blíž obci.`,
      400,
    )
  }

  return data
}

const CANCELLATION_NOTICE_DELAY_MS = 5_000

/** Cancelling an event (soft-delete via `deletedAt`) doesn't hard-delete the row — the FK
 * from existing registrations would block that anyway — so instead we notify everyone who
 * was pending/approved. The event itself already vanishes from their views on its own: it
 * fails Events' own `notDeleted` read-access check, so it simply won't populate when their
 * registrations are fetched (see getMyRegistrationsWithEvents / queries.ts). */
const notifyRegistrantsOnCancellation: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return doc
  if (previousDoc?.deletedAt || !doc.deletedAt) return doc

  try {
    // Still inside the cancel's transaction — the worker waits a moment and checks it committed.
    await notifyEventCancelled(req.payload, doc, { delay: CANCELLATION_NOTICE_DELAY_MS })
  } catch (error) {
    req.payload.logger.error(`Failed to notify registrants of cancelled event ${doc.id}: ${error}`)
  }

  // Volunteer invitations and offers still waiting on it can't be answered any more — withdrawn in
  // the same transaction, quietly (the cancellation job above tells those volunteers).
  const waiting = await req.payload.find({
    collection: 'volunteer-invitations',
    where: { and: [{ event: { equals: doc.id } }, { status: { equals: 'pending' } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const invitation of waiting.docs) {
    await req.payload.update({
      collection: 'volunteer-invitations',
      id: invitation.id,
      data: { status: 'withdrawn' },
      overrideAccess: true,
      context: { withdrawingVolunteerInvitations: true },
      req,
    })
  }

  return doc
}

/** Brief §8 / notes "pokud se změní lokalita, čas cokoliv jiného, odešle se automaticky mail na
 * všechny přihlášené a na telefonní čísla SMS, a samozřejmě upozornění do aplikace" — SMS since
 * narrowed to cancellations only (event-cancelled processor); an edit goes in-app and by e-mail. Only decides
 * *whether* — the worker re-diffs once the edit has committed, then moves the reminders and
 * tells everyone (the event-updated job). */
const notifyRegistrantsOnEdit: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !previousDoc) return doc
  if (doc.deletedAt) return doc // the cancellation hook already covers this transition
  if (changedNotifiableFields(snapshotNotifiableFields(previousDoc), doc).length === 0) return doc

  try {
    await queueEventUpdatedNotification(doc.id, previousDoc)
  } catch (error) {
    req.payload.logger.error(`Failed to queue edit notification for event ${doc.id}: ${error}`)
  }

  return doc
}

/** What an organizer is told the obec changed — everything participants hear about, plus the
 * parts of the event only its organizers look after. */
const ORGANIZER_EDIT_FIELDS: Record<string, string> = {
  ...NOTIFIABLE_EDIT_FIELDS,
  coOrganizations: 'spolupořadatelé',
  isDraft: 'zveřejnění',
  image: 'fotka',
  imagePositionX: 'fotka',
  imagePositionY: 'fotka',
  isVolunteering: 'dobrovolnictví',
}

type ObecAction = 'edited' | 'cancelled' | 'deleted'

/**
 * The obec's admin (or a platform admin) may edit, cancel or delete any organizer's event in the
 * obec — and the organizers must hear about it, in-app and by e-mail. An edit by one of the
 * event's own organizers tells the others, in-app. Changes they asked for themselves (an approved
 * obec co-organizing request, a consented deletion) don't notify from here — those
 * announce themselves. Organizers who administer the obec themselves are the obec — an event it
 * runs doesn't notify its own admins.
 */
async function notifyOrganizersOfObecAction(
  req: PayloadRequest,
  event: EventOwnership & { title: string },
  action: ObecAction,
  { formerOrganizerIds = [], changedLabels = [] }: { formerOrganizerIds?: string[]; changedLabels?: string[] } = {},
): Promise<void> {
  const { user, payload } = req
  if (!user) return
  const organizerIds = [...new Set([...eventOrganizerIds(event), ...formerOrganizerIds])]
  const municipalityId = relationId(event.municipality)
  if (!municipalityId) return
  const byObecAdmin = (await administeredIdsFor(req, user.id)).includes(municipalityId)

  if (organizerIds.includes(String(user.id))) {
    // One of the organizers edited it — the rest of them hear about it in the app. (Cancelling
    // with others on it goes through their consent, EventDeletionRequests, which tells them.)
    if (action !== 'edited' || byObecAdmin) return
    const recipients = await getEventTeamUserIds(payload, event, { exclude: [user.id], req })
    if (recipients.length === 0) return
    const profile = await payload.find({
      collection: 'profiles',
      where: { user: { equals: user.id } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    const who = profile.docs[0]?.fullName || 'Spolupořadatel'
    const change = changedLabels.length > 0 ? ` (změna: ${changedLabels.join(', ')})` : ''
    await sendNotificationToMany(payload, recipients, {
      title: 'Společná akce byla upravena',
      message: `${who} upravil(a) akci „${event.title}“, kterou spolu pořádáte${change}.`,
      link: `/akce/${event.id}`,
    })
    return
  }
  if (!byObecAdmin && user.role !== 'admin') return

  const obecAdminIds = new Set((await getMunicipalityAdminUserIds(payload, municipalityId)).map(String))
  const recipients = organizerIds.filter((id) => !obecAdminIds.has(id))
  if (recipients.length === 0) return

  let actor = 'správce Lonvity'
  if (byObecAdmin) {
    const municipality = await payload
      .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
      .catch(() => null)
    actor = municipality ? `obec ${municipality.name}` : 'obec'
  }
  const did = byObecAdmin
    ? { edited: 'upravila', cancelled: 'zrušila', deleted: 'smazala' }[action]
    : { edited: 'upravil', cancelled: 'zrušil', deleted: 'smazal' }[action]
  const who = byObecAdmin ? 'Obec' : 'Správce Lonvity'
  const change = changedLabels.length > 0 ? ` (změna: ${changedLabels.join(', ')})` : ''
  const link = action === 'edited' ? `/akce/${event.id}` : undefined
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const title = escapeHtml(event.title)

  await Promise.all(
    recipients.map((userId) =>
      sendNotification(payload, {
        userId,
        title: `${who} ${did} vaši akci`,
        message: `Vaši akci „${event.title}“ ${did} ${actor}${change}.`,
        link,
        email: {
          subject: `${who} ${did} vaši akci: ${event.title}`,
          body:
            `<p>Vaši akci <strong>${title}</strong> ${did} ${escapeHtml(actor)}${escapeHtml(change)}.</p>` +
            (link ? `<p><a href="${appUrl}${link}">Zobrazit akci</a></p>` : ''),
        },
      }),
    ),
  )
}

const OWN_REQUEST_CONTEXTS = ['skipNotifications', 'coOrganizerConsent', 'coOrganizingApproved', 'deletingMunicipality']
const isOwnRequest = (context: Record<string, unknown> | undefined) =>
  OWN_REQUEST_CONTEXTS.some((key) => context?.[key])

const notifyOrganizersOnObecChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
  if (operation !== 'update' || !previousDoc || isOwnRequest(context)) return doc

  const cancelled =
    (doc.deletedAt && !previousDoc.deletedAt) || (doc.status === 'cancelled' && previousDoc.status !== 'cancelled')
  const changedLabels = cancelled
    ? []
    : [
        ...new Set(
          Object.keys(ORGANIZER_EDIT_FIELDS)
            .filter((field) => comparable(field, doc[field]) !== comparable(field, previousDoc[field]))
            .map((field) => ORGANIZER_EDIT_FIELDS[field]),
        ),
      ]
  if (!cancelled && changedLabels.length === 0) return doc

  try {
    await notifyOrganizersOfObecAction(req, doc, cancelled ? 'cancelled' : 'edited', {
      // Someone the obec took off the event should still hear it was the obec.
      formerOrganizerIds: eventOrganizerIds(previousDoc),
      changedLabels,
    })
  } catch (error) {
    req.payload.logger.error(`Failed to notify organizers of obec change to event ${doc.id}: ${error}`)
  }
  return doc
}

/**
 * A hard-deleted event takes everything that only existed on it along — whichever way it goes (the
 * organizers' consented deletion, a platform or obec admin's DELETE, the obec itself being deleted).
 * Every row below points at the event through a NOT NULL column, so leaving one would fail the
 * delete on the database. The record of a decided deletion request stays (its event just empties);
 * one still open has nothing left to decide. The uploads go after the delete (removeEventFiles).
 */
const cleanupEventRelations: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { payload } = req
  const find = { depth: 0, pagination: false, overrideAccess: true, req } as const
  const registrations = await payload.find({ collection: 'registrations', where: { event: { equals: id } }, select: {}, ...find })
  if (registrations.docs.length > 0) {
    await payload.delete({
      collection: 'event-feedback',
      where: { registration: { in: registrations.docs.map((r) => r.id) } },
      overrideAccess: true,
      req,
    })
  }
  const event = await payload.findByID({ collection: 'events', id, depth: 0, select: { image: true }, overrideAccess: true, req })
  req.context.eventFiles = [relationId(event.image)].filter((mediaId): mediaId is string => mediaId !== null)

  // Sequential — one transaction (`req`); invitations and ratings point at registrations too.
  for (const collection of [
    'review-complaints',
    'volunteer-ratings',
    'volunteer-invitations',
    'registrations',
    'co-organizing-requests',
  ] as const) {
    await payload.delete({ collection, where: { event: { equals: id } }, overrideAccess: true, req })
  }
  await payload.delete({
    collection: 'event-deletion-requests',
    where: { and: [{ event: { equals: id } }, { status: { in: ['pending', 'escalated'] } }] },
    overrideAccess: true,
    req,
  })
}

/** The event's cover — unless another event still shows the same upload. */
const removeEventFiles: CollectionAfterDeleteHook = async ({ req }) => {
  const mediaIds = (req.context.eventFiles as string[] | undefined) ?? []
  for (const mediaId of new Set(mediaIds)) {
    try {
      const stillUsed = await req.payload.count({ collection: 'events', where: { image: { equals: mediaId } }, overrideAccess: true, req })
      if (stillUsed.totalDocs > 0) continue
      await req.payload.delete({ collection: 'media', id: mediaId, overrideAccess: true, req })
    } catch (error) {
      req.payload.logger.error(`Failed to remove media ${mediaId} of a deleted event: ${error}`)
    }
  }
}

/** Cancelling takes an event out of every overview and, months later, out of the database
 * (data-retention) — the audit log is what remembers who called it off. */
const auditCancellation: CollectionAfterChangeHook = ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !previousDoc || !req.user) return doc
  const cancelled =
    (doc.deletedAt && !previousDoc.deletedAt) || (doc.status === 'cancelled' && previousDoc.status !== 'cancelled')
  if (!cancelled) return doc
  writeAuditLog(req.payload, {
    action: 'events.cancel',
    actor: Number(req.user.id),
    targetCollection: 'events',
    targetId: doc.id,
    municipality: Number(relationId(doc.municipality)) || null,
    metadata: { title: doc.title, dateTime: doc.dateTime },
    source: req,
  })
  return doc
}

/** An obec admin (or a platform admin) deleting the event outright. A consented delete, the obec's own
 * removal and the data-retention job write entries of their own. */
const auditDelete = auditDeletion<Event>(
  (doc) => ({
    municipality: Number(relationId(doc.municipality)) || null,
    metadata: { title: doc.title, dateTime: doc.dateTime },
  }),
  isOwnRequest,
)

const notifyOrganizersOnObecDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (isOwnRequest(context)) return doc
  try {
    await notifyOrganizersOfObecAction(req, doc, 'deleted')
  } catch (error) {
    req.payload.logger.error(`Failed to notify organizers of obec deleting event ${doc.id}: ${error}`)
  }
  return doc
}

/**
 * Whoever runs the event takes part in it automatically and uses up no participant's spot: its
 * pořadatel, every spolupořadatel and — whenever the obec runs or co-organizes it — each of the
 * obec's admins (getEventTeamUserIds). So once someone joins them, their own place on the event
 * goes: the registration (participant or volunteer) is cancelled, freeing the spot, and a pending
 * volunteer invitation or offer is withdrawn. Quietly — they've just been told they run it. Pass
 * the request's `req` so it happens in the same transaction.
 */
export async function releasePlacesOfTeam(
  req: PayloadRequest,
  eventId: number | string,
  userIds: (number | string)[],
): Promise<void> {
  if (userIds.length === 0) return
  const { payload } = req

  const invitations = await payload.find({
    collection: 'volunteer-invitations',
    where: { and: [{ event: { equals: eventId } }, { volunteer: { in: userIds } }, { status: { equals: 'pending' } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const invitation of invitations.docs) {
    await payload.update({
      collection: 'volunteer-invitations',
      id: invitation.id,
      data: { status: 'withdrawn' },
      overrideAccess: true,
      context: { withdrawingVolunteerInvitations: true },
      req,
    })
  }

  const registrations = await payload.find({
    collection: 'registrations',
    where: { and: [{ event: { equals: eventId } }, { user: { in: userIds } }, { status: { in: ['pending', 'approved'] } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const registration of registrations.docs) {
    await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: { status: 'cancelled' },
      overrideAccess: true,
      context: { joiningAsOrganizer: true },
      req,
    })
  }
}

/** Someone joined the people running the event (an accepted co-organizing invitation — the obec's
 * too, a successor taking it over) — their own place on it goes (releasePlacesOfTeam). */
const releaseOrganizersPlaces: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !previousDoc) return doc
  const runBy = (event: typeof doc) =>
    JSON.stringify([
      eventOrganizerIds(event),
      relationId(event.organization),
      ((event.coOrganizations ?? []) as unknown[]).map(relationId),
      relationId(event.municipality),
    ])
  if (runBy(doc) === runBy(previousDoc)) return doc
  const before = new Set(await getEventTeamUserIds(req.payload, previousDoc, { req }))
  const joined = (await getEventTeamUserIds(req.payload, doc, { req })).filter((id) => !before.has(id))
  await releasePlacesOfTeam(req, doc.id, joined)
  return doc
}

/** Scheduled once at creation time; moved along with the event if it's later rescheduled. */
const scheduleAttendanceReminderOnCreate: CollectionAfterChangeHook = async ({ doc, operation, req, context }) => {
  // Seeded demo events (src/lib/seed/run.ts) don't queue organizer reminders.
  if (operation !== 'create' || context?.skipNotifications) return doc

  try {
    await scheduleAttendanceReminder(doc as Parameters<typeof scheduleAttendanceReminder>[0])
  } catch (error) {
    req.payload.logger.error(`Failed to schedule attendance reminder for event ${doc.id}: ${error}`)
  }

  return doc
}

/**
 * US-P-08: an 'active'/'full' event whose end (or, single-day, start) time has passed reads back
 * as 'finished' straight away. Only derived here — the worker's sync-statuses job writes it down
 * every quarter of an hour, in bulk and without running the change hooks, so a read never writes.
 */
const deriveFinishedStatus: CollectionAfterReadHook = ({ doc }) => {
  if (doc.status !== 'active' && doc.status !== 'full') return doc
  if (!hasEventEnded(doc.dateTime, doc.endDateTime)) return doc
  return { ...doc, status: 'finished' }
}

export const Events: CollectionConfig = {
  slug: 'events',
  labels: {
    singular: 'Event',
    plural: 'Events',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'municipality', 'dateTime', 'capacity', 'updatedAt'],
  },
  access: {
    // Public marketplace listing — open to signed-out visitors too (brief §2 "Nepřihlášený
    // návštěvník má mít možnost prohlédnout si přehled akcí v obci"). The frontend filters by
    // municipality itself (matches the existing Index.tsx query pattern: .eq('municipality_id', muniId)).
    // A hidden event only for those it concerns (canReadEvent).
    read: canReadEvent,
    // Brief §3 "Pravidla pro vznik akcí" — gated per-municipality instead of any logged-in user.
    create: canCreateEvent,
    update: canUpdateEvent,
    delete: canDeleteEvent,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      access: { update: platformAdminOnly },
    },
    {
      name: 'dateTime',
      type: 'date',
      required: true,
      index: true,
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'endDateTime',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        description:
          'Brief §4 "Datum jako rozsah" — an event can span more than one day. Leave empty for a single-day event.',
      },
    },
    {
      name: 'locationText',
      type: 'text',
      required: true,
      admin: {
        description: 'Human-readable label for the picked location (from the map picker\'s search result, editable).',
      },
    },
    {
      name: 'lat',
      type: 'number',
      required: true,
      admin: {
        description: 'Brief §12 "ROZHODNĚ NE NAPSAT LOKACI" — set via the map picker, never typed freehand.',
      },
    },
    {
      name: 'lng',
      type: 'number',
      required: true,
    },
    {
      name: 'accessibilityTags',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Bezbariérový přístup', value: 'wheelchair_access' },
        { label: 'Indukční smyčka', value: 'induction_loop' },
        { label: 'Možnost sezení', value: 'seating' },
        { label: 'WC pro invalidy', value: 'accessible_wc' },
      ],
      admin: {
        description:
          'Brief §4/§6 "Tag přístupnosti místa konání" — set by the organizer, shown to participants on the event.',
      },
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'registrationApprovalMode',
      type: 'select',
      required: true,
      defaultValue: 'manual',
      options: [
        { label: 'Bez schvalování', value: 'auto' },
        { label: 'S potvrzením organizátora', value: 'manual' },
      ],
      admin: {
        description:
          'Brief §4 "Přihlašování účastníků" — chosen per event by the organizer. "auto" also gates the server-side capacity check on Registrations.',
      },
    },
    {
      name: 'organizer',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: { update: platformAdminOnly },
      admin: {
        description: 'The user organizing this event. Additional organizers: see coOrganizations below.',
      },
    },
    {
      // Derived from `organizer` (resolveOrganizations) — never set by the client.
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      access: { create: () => false, update: () => false },
      admin: {
        readOnly: true,
        description:
          "The organization the organizer runs this event as — the obec's own one when its admin founded it.",
      },
    },
    {
      name: 'coOrganizations',
      type: 'relationship',
      relationTo: 'organizations',
      hasMany: true,
      admin: {
        description:
          'Brief §4 "Spolupořadatelství" — organizations of the same obec running the event together with the organizer (e.g. the local café, or the obec itself). Each joins only by accepting an invitation (CoOrganizingRequests). The event appears in each owner\'s own dashboard/"moje akce".',
      },
    },
    {
      // Derived from coOrganizations (resolveOrganizations) — never set by the client.
      name: 'coOrganizers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      access: { create: () => false, update: () => false },
      admin: {
        readOnly: true,
        description:
          "The owners of coOrganizations — what access checks, deletion consent and the co-organizers' dashboards key on.",
      },
    },
    {
      // Set once (resolveOrganizations) — never by the client.
      name: 'obecLeftAt',
      type: 'date',
      access: { create: () => false, update: () => false },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description:
          'When the obec stepped off co-organizing the event (its own decision, no consent needed). It can never co-organize it again.',
      },
    },
    {
      // The viewer is the event's creator (isEventCreator) — tells the frontend who fills in its
      // attendance and decides about its volunteers. The collections enforce it themselves.
      name: 'creatorForViewer',
      type: 'checkbox',
      virtual: true,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
      hooks: { afterRead: [resolveCreatorForViewer] },
    },
    {
      // The viewer runs this event with other organizers — deleting it goes through an
      // EventDeletionRequest (their consent) instead of the plain cancel.
      name: 'deletionNeedsConsent',
      type: 'checkbox',
      virtual: true,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
      hooks: { afterRead: [resolveDeletionNeedsConsent] },
    },
    {
      // Tells the creator's form and Dobrovolnictví card to drop the "take the mark off" control —
      // guardIsVolunteering is what actually enforces it.
      name: 'volunteeringLocked',
      type: 'checkbox',
      virtual: true,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
      hooks: { afterRead: [resolveVolunteeringLocked] },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Full', value: 'full' },
        { label: 'Finished', value: 'finished' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      // A draft (koncept): its creator's alone until published (canReadEvent) — no sign-ups, no
      // invitations. Back to a draft only while nobody is on it (guardBackToDraft).
      name: 'isDraft',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      access: { update: isCreatorOrPlatformAdmin },
    },
    {
      // Retired: "put on hold" gave way to drafts (isDraft). Nothing reads or sets it; a migration
      // removes it.
      name: 'isHidden',
      type: 'checkbox',
      defaultValue: false,
      access: { read: () => false, create: () => false, update: () => false },
      admin: { hidden: true },
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'event-categories',
      hasMany: true,
      required: true,
      admin: {
        description:
          'Brief §2 "Jedna akce může mít víc kategorií zároveň" — one or more categories. Filtering by a category matches any event that has it among its categories.',
      },
    },
    {
      name: 'image',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        description: 'Cover image shown in event listings.',
      },
    },
    {
      name: 'imagePositionX',
      type: 'number',
      min: 0,
      max: 100,
      defaultValue: 50,
      admin: {
        description:
          'Brief §4 "pevně daný ořez pro přehledovou stránku" — horizontal framing of the photo in the fixed 16:10 crop (event cards, detail), as a CSS object-position percentage. Set by dragging the photo in the event form.',
        condition: (data) => Boolean(data?.image),
      },
    },
    {
      name: 'imagePositionY',
      type: 'number',
      min: 0,
      max: 100,
      defaultValue: 50,
      admin: {
        description: 'Vertical framing of the photo in the crop, as a CSS object-position percentage.',
        condition: (data) => Boolean(data?.image),
      },
    },
    {
      name: 'isVolunteering',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Tagged by the organizer at creation — feeds the Datavita "share of volunteers" metric.',
      },
    },
    {
      name: 'isPaid',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'priceCents',
      type: 'number',
      min: 0,
      admin: {
        description:
          'Price in the smallest currency unit (e.g. haléře). Informational only — the app does not process payment; the organizer handles it outside the app (brief §4).',
        condition: (data) => Boolean(data?.isPaid),
      },
    },
    {
      name: 'deletedAt',
      type: 'date',
      index: true,
      admin: {
        description: 'Soft-delete marker — preserves attendance history when an event is removed.',
        position: 'sidebar',
      },
    },
    {
      // Set once (stampImportedFrom) — never by the client.
      name: 'importedFrom',
      type: 'text',
      access: { create: () => false, update: () => false },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: "The page the event was imported from (EventImportCandidates) — shown on the event as its source.",
      },
    },
  ],
  hooks: {
    beforeOperation: [guardUpcomingDelete],
    beforeChange: [
      stampImportedFrom,
      sealCancellation,
      guardCancellationWindow,
      validateEventDates,
      validateEventLocationRadius,
      requireOrganizerRole,
      resolveOrganizations,
      guardCoOrganizedChanges,
      guardIsVolunteering,
      guardBackToDraft,
    ],
    afterChange: [
      notifyRegistrantsOnCancellation,
      auditCancellation,
      notifyRegistrantsOnEdit,
      notifyOrganizersOnObecChange,
      scheduleAttendanceReminderOnCreate,
      releaseOrganizersPlaces,
    ],
    beforeDelete: [cleanupEventRelations],
    afterDelete: [auditDelete, notifyOrganizersOnObecDelete, removeEventFiles],
    afterRead: [deriveFinishedStatus],
  },
  timestamps: true,
}
