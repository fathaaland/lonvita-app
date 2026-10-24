import type { Payload, Where } from 'payload'
import { APIError } from 'payload'

import { mayManageImport } from '@/collections/access/import'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { pragueDateKey } from '@/lib/date'
import { hasEventEnded } from '@/lib/eventEnded'
import { logger, serializeError } from '@/lib/logger'
import { relationNumber } from '@/lib/relations'
import type { Event, EventImportCandidate, User } from '@/payload-types'

import {
  IMPORT_LIMITS,
  type ExtractedEvent,
  type SyncField,
  type SyncNotice,
  type SyncNoticeCode,
} from './contracts'
import type { LocateResult, Point } from './geocode'
import { locationTextOf, normalizeText } from './normalize'

/**
 * Keeping a taken-over event in step with its source (docs/import-akci-z-webu.md). Three versions of
 * each field are compared: what the source said last time (kept on the candidate), what it says now,
 * and what the event in Lonvita says. A field the source changed and nobody changed in Lonvita is
 * changed on the event too — through the Events collection, so its registrants hear about it
 * (notifyRegistrantsOnEdit). One somebody changed in Lonvita is left alone, and so is one the change
 * can't be made to (a time the source doesn't state, a place not found on the map): the owner gets
 * a notice (SYNC_NOTICES) and decides. Synced are the date, the time and the place — the title only
 * from a calendar (iCal, schema.org), never the description: the AI words both anew on every read.
 * Nothing is ever cancelled here: the source calling it off, or dropping it, is a notice too.
 */

export type SyncCandidate = Pick<
  EventImportCandidate,
  | 'id'
  | 'externalKey'
  | 'sourceRef'
  | 'title'
  | 'startsAt'
  | 'endsAt'
  | 'timeKnown'
  | 'locationText'
  | 'lat'
  | 'lng'
  | 'event'
  | 'syncNotices'
  | 'missingCount'
>

export type SyncPair = {
  candidate: SyncCandidate
  extracted: ExtractedEvent
  key: string
  ref: string | null
  startsAt: string
  endsAt: string | null
}

export type SyncContext = {
  municipalityId: number
  sourceId: number | null
  /** The source is a calendar (iCal, schema.org) — its titles are exact, so they're synced too. */
  deterministic: boolean
  now: Date
  locate: (event: ExtractedEvent) => Promise<LocateResult>
}

const msOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)

/** What Events keeps as the end — only a multi-day event has one (validateEventDates). */
export const eventEndOf = (startsAt: string, endsAt: string | null | undefined): string | null =>
  endsAt && pragueDateKey(endsAt) > pragueDateKey(startsAt) ? endsAt : null

const samePlace = (a: string | null | undefined, b: string | null | undefined) =>
  normalizeText(a ?? '') === normalizeText(b ?? '')

export const noticesOf = (candidate: { syncNotices?: unknown }): SyncNotice[] =>
  Array.isArray(candidate.syncNotices) ? (candidate.syncNotices as SyncNotice[]) : []

function withNotice(
  notices: SyncNotice[],
  code: SyncNoticeCode,
  fields?: SyncField[],
): SyncNotice[] {
  const existing = notices.find((n) => n.code === code)
  const merged = fields ? [...new Set([...(existing?.fields ?? []), ...fields])] : undefined
  return [...notices.filter((n) => n.code !== code), merged ? { code, fields: merged } : { code }]
}

const withoutNotice = (notices: SyncNotice[], ...codes: SyncNoticeCode[]) =>
  notices.filter((n) => !codes.includes(n.code))

/** Whether `after` holds something `before` didn't — what the owner should hear about. */
const addsNotice = (before: SyncNotice[], after: SyncNotice[]) =>
  after.some((n) => {
    const was = before.find((b) => b.code === n.code)
    return !was || (n.fields ?? []).some((f) => !(was.fields ?? []).includes(f))
  })

const isOpen = (event: Event | null, now: Date): event is Event =>
  Boolean(event) &&
  !event!.deletedAt &&
  event!.status !== 'cancelled' &&
  !hasEventEnded(event!.dateTime, event!.endDateTime, now.getTime())

const loadEvent = (payload: Payload, id: number | null): Promise<Event | null> =>
  id
    ? payload
        .findByID({ collection: 'events', id, depth: 0, overrideAccess: true })
        .catch(() => null)
    : Promise.resolve(null)

type SyncOutcome = { applied: boolean; newNotice: boolean }

async function syncOne(payload: Payload, pair: SyncPair, ctx: SyncContext): Promise<SyncOutcome> {
  const { candidate: c, extracted, startsAt, endsAt } = pair
  const eventId = relationNumber(c.event)
  const event = await loadEvent(payload, eventId)
  const open = isOpen(event, ctx.now)
  const nowIso = ctx.now.toISOString()

  const base = {
    title: c.title,
    startsAt: c.startsAt,
    timeKnown: c.timeKnown !== false,
    end: eventEndOf(c.startsAt, c.endsAt),
    place: c.locationText ?? null,
  }
  const theirs = {
    title: extracted.title,
    startsAt,
    timeKnown: Boolean(extracted.start.time),
    end: eventEndOf(startsAt, endsAt),
    place: locationTextOf(extracted),
  }

  // What the source changed — a time it no longer states isn't a change, only its date moving is.
  const changed: SyncField[] = []
  if (ctx.deterministic && normalizeText(theirs.title) !== normalizeText(base.title))
    changed.push('title')
  const startChanged =
    theirs.timeKnown || !base.timeKnown
      ? msOf(theirs.startsAt) !== msOf(base.startsAt)
      : pragueDateKey(theirs.startsAt) !== pragueDateKey(base.startsAt)
  if (startChanged) changed.push('start')
  if (theirs.end && msOf(theirs.end) !== msOf(base.end)) changed.push('end')
  if (theirs.place && !samePlace(theirs.place, base.place)) changed.push('place')

  const before = noticesOf(c)
  let notices = withoutNotice(before, 'missing_at_source')
  notices =
    extracted.cancelled && open
      ? withNotice(notices, 'cancelled_at_source')
      : withoutNotice(notices, 'cancelled_at_source')

  // A new place is looked up either way — applied now, or by the owner later (applySourceChanges).
  let located: Point | null = null
  if (changed.includes('place') && open) {
    const result = await ctx.locate(extracted)
    if ('point' in result) located = result.point
  }

  const data: Partial<Event> = {}
  const applied: SyncField[] = []
  const conflicts: SyncField[] = []
  const notApplied: SyncField[] = []
  if (open) {
    for (const field of changed) {
      const ours = {
        title: normalizeText(event.title),
        start: msOf(event.dateTime),
        end: msOf(event.endDateTime),
        place: normalizeText(event.locationText ?? ''),
      }[field]
      const was = {
        title: normalizeText(base.title),
        start: msOf(base.startsAt),
        end: msOf(base.end),
        place: normalizeText(base.place ?? ''),
      }[field]
      const now = {
        title: normalizeText(theirs.title),
        start: msOf(theirs.startsAt),
        end: msOf(theirs.end),
        place: normalizeText(theirs.place ?? ''),
      }[field]
      if (ours === now) continue // Lonvita already says what the source now says.
      if (ours !== was) {
        conflicts.push(field)
        continue
      }
      if (field === 'title') data.title = theirs.title
      if (field === 'start') {
        if (!theirs.timeKnown || msOf(theirs.startsAt)! <= ctx.now.getTime()) {
          notApplied.push(field)
          continue
        }
        data.dateTime = theirs.startsAt
      }
      if (field === 'end') data.endDateTime = theirs.end
      if (field === 'place') {
        if (!located) {
          notApplied.push(field)
          continue
        }
        Object.assign(data, { locationText: theirs.place, lat: located.lat, lng: located.lng })
      }
      applied.push(field)
    }
  }

  if (applied.length > 0 && eventId && event) {
    try {
      await payload.update({
        collection: 'events',
        id: eventId,
        data,
        overrideAccess: true,
        context: { importSync: true },
      })
      writeAuditLog(payload, {
        action: 'events.import-sync',
        actor: null,
        targetCollection: 'events',
        targetId: eventId,
        municipality: ctx.municipalityId,
        metadata: {
          candidate: c.id,
          source: ctx.sourceId,
          fields: applied,
          before: {
            title: event.title,
            dateTime: event.dateTime,
            endDateTime: event.endDateTime ?? null,
            locationText: event.locationText,
          },
          after: data,
        },
      })
    } catch (error) {
      // One of the event's own rules refused it (an end before the new start…) — the owner decides.
      logger.info('Source change not applied', {
        event: 'import.sync_refused',
        candidateId: c.id,
        eventId,
        fields: applied,
        ...serializeError(error),
      })
      notApplied.push(...applied.splice(0))
    }
  }
  if (conflicts.length > 0) notices = withNotice(notices, 'changed', conflicts)
  if (notApplied.length > 0) notices = withNotice(notices, 'not_applied', notApplied)

  // From now on what the source said this time is what the next pass compares with. A time it no
  // longer states keeps the one it stated (and a missing end or place the ones it had).
  const keepTime = !theirs.timeKnown && base.timeKnown && !startChanged
  const newNotice = addsNotice(before, notices)
  const update = {
    title: theirs.title,
    startsAt: keepTime ? base.startsAt : theirs.startsAt,
    timeKnown: keepTime ? true : theirs.timeKnown,
    endsAt: theirs.end ? endsAt : (c.endsAt ?? null),
    ...(theirs.place
      ? {
          locationText: theirs.place,
          ...(changed.includes('place')
            ? { lat: located?.lat ?? null, lng: located?.lng ?? null }
            : {}),
        }
      : {}),
    syncNotices: notices,
    syncNeedsReview: notices.length > 0,
    ...(newNotice ? { noticedAt: nowIso } : {}),
    lastSeenAt: nowIso,
    ...(applied.length > 0 ? { lastSyncedAt: nowIso } : {}),
    missingCount: 0,
  }
  try {
    await payload.update({
      collection: 'event-import-candidates',
      id: c.id,
      data: { ...update, externalKey: pair.key, sourceRef: pair.ref },
      overrideAccess: true,
    })
  } catch {
    // The moved event's new key is another candidate's — it keeps its own.
    await payload.update({
      collection: 'event-import-candidates',
      id: c.id,
      data: update,
      overrideAccess: true,
    })
  }
  return { applied: applied.length > 0, newNotice }
}

/** Brings every taken-over event of the pass in step with its source (see the module comment). */
export async function syncTakenOver(
  payload: Payload,
  pairs: SyncPair[],
  ctx: SyncContext,
): Promise<{ synced: number; needsReview: number }> {
  let synced = 0
  let needsReview = 0
  for (const pair of pairs) {
    try {
      const outcome = await syncOne(payload, pair, ctx)
      if (outcome.applied) synced++
      if (outcome.newNotice) needsReview++
    } catch (error) {
      logger.warn('Taken-over event not synced', {
        event: 'import.sync_failed',
        candidateId: pair.candidate.id,
        ...serializeError(error),
      })
    }
  }
  return { synced, needsReview }
}

/**
 * Candidates of the source the pass didn't find again — only those dated within what the source
 * still lists (a page showing the next month doesn't drop what's after it), only once it's been
 * missing IMPORT_LIMITS.missingPassesBeforeNotice passes in a row (the AI may skip one now and then).
 * A pending one gets a warning, a taken-over one a notice; neither is removed or cancelled.
 */
export async function markMissing(
  payload: Payload,
  {
    sourceId,
    owner,
    from,
    to,
    matched,
    now,
  }: { sourceId: number; owner: Where; from: string; to: string; matched: Set<number>; now: Date },
): Promise<{ newlyNoticed: number }> {
  const candidates = await payload.find({
    collection: 'event-import-candidates',
    where: {
      and: [
        owner,
        { source: { equals: sourceId } },
        { status: { in: ['pending', 'approved'] } },
        { startsAt: { greater_than_equal: from } },
        { startsAt: { less_than_equal: to } },
        { startsAt: { greater_than: now.toISOString() } },
      ],
    },
    select: { status: true, warnings: true, syncNotices: true, missingCount: true, event: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  let newlyNoticed = 0
  for (const c of candidates.docs) {
    if (matched.has(c.id)) continue
    const missingCount = (c.missingCount ?? 0) + 1
    const data: Record<string, unknown> = { missingCount }
    if (missingCount >= IMPORT_LIMITS.missingPassesBeforeNotice) {
      if (c.status === 'pending') {
        const warnings = (c.warnings as string[] | null) ?? []
        if (!warnings.includes('missing_at_source'))
          data.warnings = [...warnings, 'missing_at_source']
      } else {
        const notices = noticesOf(c)
        const open = isOpen(await loadEvent(payload, relationNumber(c.event)), now)
        if (open && !notices.some((n) => n.code === 'missing_at_source')) {
          Object.assign(data, {
            syncNotices: withNotice(notices, 'missing_at_source'),
            syncNeedsReview: true,
            noticedAt: now.toISOString(),
          })
          newlyNoticed++
        }
      }
    }
    await payload.update({
      collection: 'event-import-candidates',
      id: c.id,
      data,
      overrideAccess: true,
    })
  }
  return { newlyNoticed }
}

type Actor = Pick<User, 'id' | 'role'>

async function loadNoticed(payload: Payload, user: Actor, candidateId: number | string) {
  const candidate = await payload
    .findByID({
      collection: 'event-import-candidates',
      id: candidateId,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null)
  if (!candidate || candidate.status !== 'approved')
    throw new APIError('Převzatá akce neexistuje.', 404)
  if (!(await mayManageImport(payload, user, candidate)))
    throw new APIError('O změnách téhle akce rozhoduje její pořadatel.', 403)
  return candidate
}

/** "Beru na vědomí" — the owner has seen what the source did; the notices go. */
export async function dismissSyncNotices(
  payload: Payload,
  user: Actor,
  candidateId: number | string,
): Promise<void> {
  const candidate = await loadNoticed(payload, user, candidateId)
  await payload.update({
    collection: 'event-import-candidates',
    id: candidate.id,
    data: { syncNotices: [], syncNeedsReview: false },
    overrideAccess: true,
  })
}

/**
 * "Převzít z webu" — what the source says now, in the fields it was noted for, onto the event — by
 * the owner, through the Events collection with access control on: the same edit as by hand,
 * registrants told about it the same way.
 */
export async function applySourceChanges(
  payload: Payload,
  user: Actor,
  candidateId: number | string,
  source?: { headers?: unknown },
): Promise<void> {
  const candidate = await loadNoticed(payload, user, candidateId)
  const notices = noticesOf(candidate)
  const fields = [
    ...new Set(
      notices
        .filter((n) => n.code === 'changed' || n.code === 'not_applied')
        .flatMap((n) => n.fields ?? []),
    ),
  ]
  const eventId = relationNumber(candidate.event)
  if (fields.length === 0 || !eventId) throw new APIError('Z webu tu není co převzít.', 400)

  const data: Partial<Event> = {}
  for (const field of fields) {
    if (field === 'title') data.title = candidate.title
    if (field === 'start') {
      if (candidate.timeKnown === false)
        throw new APIError('Web neuvádí čas začátku — upravte akci ručně.', 400)
      data.dateTime = candidate.startsAt
    }
    if (field === 'end') data.endDateTime = eventEndOf(candidate.startsAt, candidate.endsAt)
    if (field === 'place') {
      if (candidate.lat == null || candidate.lng == null || !candidate.locationText)
        throw new APIError('Místo z webu se nepodařilo najít na mapě — upravte akci ručně.', 400)
      Object.assign(data, {
        locationText: candidate.locationText,
        lat: candidate.lat,
        lng: candidate.lng,
      })
    }
  }
  await payload.update({
    collection: 'events',
    id: eventId,
    data,
    user: user as never,
    overrideAccess: false,
  })
  const remaining = withoutNotice(notices, 'changed', 'not_applied')
  await payload.update({
    collection: 'event-import-candidates',
    id: candidate.id,
    data: {
      syncNotices: remaining,
      syncNeedsReview: remaining.length > 0,
      lastSyncedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })
  writeAuditLog(payload, {
    source,
    action: 'events.import-sync-apply',
    actor: Number(user.id),
    targetCollection: 'events',
    targetId: eventId,
    municipality: relationNumber(candidate.municipality),
    metadata: { candidate: candidate.id, fields },
  })
}
