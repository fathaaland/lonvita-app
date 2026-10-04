import type {
  Access,
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
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
import { notDeleted } from './shared/softDelete'
import { escapeHtml, getEventTeamUserIds, getMunicipalityAdminUserIds, sendNotification, sendNotificationToMany } from './shared/notify'
import { scheduleAttendanceReminder } from './shared/reminders'
import { guardCancellationWindow } from './shared/eventCancellation'
import {
  NOTIFIABLE_EDIT_FIELDS,
  changedNotifiableFields,
  comparable,
  notifyEventCancelled,
  queueEventUpdatedNotification,
  snapshotNotifiableFields,
} from './shared/eventNotifications'
import { hasEventEnded } from '@/lib/eventEnded'
import { haversineDistanceKm } from '@/lib/geo/distance'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

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

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
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
 * Whenever the obec takes part in an event — it runs it (its admin founded it, so its
 * `organization` is the obec's) or co-organizes it (its organization is among `coOrganizations`) —
 * the event is the obec's: only the obec's admins may edit or delete it. The other organizations on
 * it still help run it (see the attendees, approve registrations, mark attendance — Registrations
 * keeps that). Without the obec, everyone organizing it has equal rights. And the obec admin may
 * step into any organizer's event in their obec (a problem, a fraud).
 *
 * Of `events`, returns the ids `userId` organizes or co-organizes but is locked out of. Events
 * whose obec they administer themselves are never locked.
 */
export async function lockedEventIds(
  req: PayloadRequest,
  userId: number | string,
  events: EventOwnership[],
  administeredIds: string[],
): Promise<Set<string>> {
  const uid = String(userId)
  const candidates = events.filter(
    (e) => eventOrganizerIds(e).includes(uid) && !administeredIds.includes(relationId(e.municipality) ?? ''),
  )
  if (candidates.length === 0) return new Set()

  const obecOrganizations = await municipalityOrganizationIds(
    req,
    candidates.map((e) => relationId(e.municipality)).filter((id): id is string => id !== null),
  )
  return new Set(
    candidates
      .filter((e) => {
        const obecOrganizationId = obecOrganizations.get(relationId(e.municipality) ?? '')
        if (obecOrganizationId === undefined) return false
        return (
          relationId(e.organization) === obecOrganizationId ||
          ((e.coOrganizations ?? []) as unknown[]).map(relationId).includes(obecOrganizationId)
        )
      })
      .map((e) => String(e.id)),
  )
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

/** Brief §4 organizer self-service edit of their own event — the organizer or a co-organizer, a
 * municipality admin for any event in their obec, and a platform admin everywhere. Organizers are
 * shut out of events the obec takes part in (lockedEventIds). Cancelling an event several
 * organizers run needs the others' consent (guardCoOrganizedChanges). Moving an event to
 * another obec or handing it to another organizer stays platform-admin-only (field access below).
 * An event that has taken place is nobody's to edit any more, a platform admin's neither.
 * Trusted internal writes (overrideAccess) — e.g. flipping status to "full" — bypass this as usual. */
const canUpdateEvent: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return notYetEnded()

  const administeredIds = await administeredIdsFor(req, user.id)
  const organized = await payload.find({
    collection: 'events',
    where: { or: [{ organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }] },
    select: { organizer: true, organization: true, coOrganizations: true, coOrganizers: true, municipality: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const lockedIds = await lockedEventIds(req, user.id, organized.docs, administeredIds)

  const organizerWhere: Where = { or: [{ organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }] }
  const or: Where[] = [
    lockedIds.size > 0 ? { and: [organizerWhere, { id: { not_in: [...lockedIds] } }] } : organizerWhere,
  ]
  if (administeredIds.length > 0) or.push({ municipality: { in: administeredIds } })
  const where: Where = { and: [notYetEnded(), { or }] }
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
  if (user.role === 'admin') return true
  const administeredIds = await administeredIdsFor(req, user.id)
  if (administeredIds.includes(relationId(event.municipality) ?? '')) return true
  if (!eventOrganizerIds(event).includes(String(user.id))) return false
  return !(await lockedEventIds(req, user.id, [event], administeredIds)).has(String(event.id))
}

/** Whether `user` must go through an EventDeletionRequest (the others' consent) rather than
 * cancel the event outright: they organize it together with another organizer, or with the obec,
 * and aren't an admin of its obec (who may always cancel — and who, on an event the obec runs,
 * locks organizers out of it entirely anyway). */
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
 * spolupořadatel off — not even themselves: leaving goes through an EventDeletionRequest too (the
 * others agree to it, or the obec decides), which takes them off with that same context. An event
 * the obec takes part in never gets here from an organizer — they're locked out of it
 * (lockedEventIds). The obec's admins and a platform admin are exempt from all of it.
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

  if (data.coOrganizers && req.user.role !== 'admin') {
    const administeredIds = await administeredIdsFor(req, req.user.id)
    if (!administeredIds.includes(relationId(originalDoc.municipality) ?? '')) {
      const kept = new Set((data.coOrganizers as unknown[]).map(relationId))
      const removed = ((originalDoc.coOrganizers ?? []) as unknown[])
        .map(relationId)
        .filter((id) => id !== null && !kept.has(id))
      if (removed.length > 0) {
        throw new APIError(
          'Spolupořadatele z akce odebrat nemůžete — z akce se odchází jen přes žádost o smazání (se souhlasem ostatních, nebo rozhodnutím obce). Přímo spolupořadatele odebere jen admin obce.',
          400,
        )
      }
    }
  }

  return data
}

/** Platform/municipality admin everywhere they administer — a hard DELETE isn't part of the
 * organizer's self-service (cancelling is the soft-delete PATCH above). */
const canDeleteEvent: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length === 0) return false
  const where: Where = { municipality: { in: administeredIds } }
  return where
}

const platformAdminOnly = ({ req: { user } }: { req: { user: { role?: string } | null } }) => user?.role === 'admin'

/**
 * The volunteering flag is the event creator's (`organizer`) alone — they mark their event as one
 * for volunteers themselves, no obec approval needed, and take the mark off again. Not a
 * spolupořadatel's, not the obec's — whether it co-organizes the event or merely oversees it. A
 * platform admin may always, and so may trusted internal writes (no user). Anyone else's attempt is
 * dropped.
 */
const guardIsVolunteering: CollectionBeforeChangeHook = ({ data, req, originalDoc }) => {
  if (!data || data.isVolunteering === undefined) return data
  if (data.isVolunteering === Boolean(originalDoc?.isVolunteering)) return data

  const { user } = req
  if (!user || user.role === 'admin') return data

  if (relationId(data.organizer ?? originalDoc?.organizer) !== String(user.id)) {
    data.isVolunteering = originalDoc?.isVolunteering ?? false
  }

  return data
}

/** Whether `user` decides about the event's volunteering — sets the flag and invites volunteers
 * from the pool: its creator alone, and a platform admin. */
export const isEventCreator = (
  user: { id: number | string; role?: string | null },
  event: Pick<EventOwnership, 'organizer'>,
): boolean => user.role === 'admin' || relationId(event.organizer) === String(user.id)

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
 *   obec's when they're its admin (it's the obec's event — see lockedEventIds);
 * - `coOrganizers` — the organizations' owners, the users every ownership check (canUpdateEvent,
 *   lockedEventIds, deletion consent, Registrations) works with. The obec's organization has no
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

/** Only resolved for a viewer who organizes the event — the only one either can be true for — so
 * a public listing doesn't pay for a user-roles lookup per event. */
const resolveLockedForViewer: FieldHook = async ({ req, siblingData }) => {
  const { user } = req
  if (!user || user.role === 'admin' || !siblingData?.id) return false
  const event = siblingData as EventOwnership
  if (!eventOrganizerIds(event).includes(String(user.id))) return false

  const locked = await lockedEventIds(req, user.id, [event], await administeredIdsFor(req, user.id))
  return locked.has(String(event.id))
}

const resolveDeletionNeedsConsent: FieldHook = async ({ req, siblingData }) => {
  const { user } = req
  if (!user || !siblingData?.id) return false
  const event = siblingData as EventOwnership
  if (!(await deletionNeedsConsent(req, user, event))) return false
  // Locked out entirely — there's nothing for them to delete.
  const locked = await lockedEventIds(req, user.id, [event], await administeredIdsFor(req, user.id))
  return !locked.has(String(event.id))
}

/** A new event can't start in the past, and neither can one that gets rescheduled — but the
 * start is only checked when it actually changes, so editing e.g. the title of an event that is
 * already running (or over) keeps working. A multi-day event can't end before it starts. */
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
const validateEventLocationRadius: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data) return data

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
      `Místo konání je ${distanceKm.toFixed(1)} km od obce „${municipality.name}“, což přesahuje povolený okruh ${radiusKm} km. Vyberte místo blíž obci, nebo upravte okruh v nastavení obce.`,
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

  return doc
}

/** Brief §8 / notes "pokud se změní lokalita, čas cokoliv jiného, odešle se automaticky mail na
 * všechny přihlášené a na telefonní čísla SMS, a samozřejmě upozornění do aplikace". Only decides
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
  isHidden: 'zveřejnění',
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

const OWN_REQUEST_CONTEXTS = ['skipNotifications', 'coOrganizerConsent', 'coOrganizingApproved']
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
    read: () => notDeleted,
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
      name: 'recurrenceRule',
      type: 'text',
      admin: {
        description:
          'Brief §4 "Opakující se série" (e.g. "weekly:tuesday") — a simple machine-readable rule set on the first occurrence only. Combines with endDateTime for a multi-day recurring series. Occurrence generation is a separate, later piece; this field just records the intent.',
      },
    },
    {
      name: 'recurrenceParent',
      type: 'relationship',
      relationTo: 'events',
      admin: {
        description: 'Set on a generated occurrence, pointing back at the event that defines recurrenceRule.',
        position: 'sidebar',
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
      // Tells the frontend to hide Upravit/Zrušit for an organizer on an event the obec takes part
      // in — canUpdateEvent is what actually enforces it.
      name: 'lockedForViewer',
      type: 'checkbox',
      virtual: true,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
      hooks: { afterRead: [resolveLockedForViewer] },
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
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Full', value: 'full' },
        { label: 'Finished', value: 'finished' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'isHidden',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Temporarily unpublish the event without cancelling it — registrations and data stay intact, it just drops out of the public feed/map.',
      },
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
      admin: {
        description: 'Soft-delete marker — preserves attendance history when an event is removed.',
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeChange: [
      guardCancellationWindow,
      validateEventDates,
      validateEventLocationRadius,
      requireOrganizerRole,
      resolveOrganizations,
      guardCoOrganizedChanges,
      guardIsVolunteering,
    ],
    afterChange: [
      notifyRegistrantsOnCancellation,
      notifyRegistrantsOnEdit,
      notifyOrganizersOnObecChange,
      scheduleAttendanceReminderOnCreate,
      releaseOrganizersPlaces,
    ],
    afterDelete: [notifyOrganizersOnObecDelete],
    afterRead: [deriveFinishedStatus],
  },
  timestamps: true,
}
