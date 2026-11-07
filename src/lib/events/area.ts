import type { Payload } from 'payload'

import { sendOpsAlert } from '@/lib/alerts/ops'
import { hasEventEnded } from '@/lib/eventEnded'
import { haversineDistanceKm } from '@/lib/geo/distance'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'
import { relationId } from '@/lib/relations'

/**
 * Where an obec's events take place, against its contractual radius (Municipalities.eventRadiusKm).
 *
 * Creating an event anywhere in the country is allowed (decided 7. 11. 2026): the obec and its
 * pořadatelé undertake in the contract to keep their events around the obec, and it's the obec's job
 * to see to it. The platform only watches — the superadmin's map of each obec (superadmin/obce/[id])
 * and an alert when a published event lands outside the radius — so that, say, Brno's licence isn't
 * used to run Blansko's events.
 *
 * A standalone event is measured against its own obec's radius. A mikroregionální one — co-organized
 * by another obec's organization — may be held in the radius of any obec taking part in it: Brno and
 * Blansko's joint event is fine in Blansko, Brno alone running one there is not. Belonging to the
 * same mikroregion gives no such right by itself.
 */

export const DEFAULT_EVENT_RADIUS_KM = 15

type Area = { lat: number; lng: number; eventRadiusKm?: number | null }

export const radiusOf = (area: Pick<Area, 'eventRadiusKm'>): number => area.eventRadiusKm ?? DEFAULT_EVENT_RADIUS_KM

export const distanceFromObecKm = (point: { lat: number; lng: number }, area: Area): number =>
  haversineDistanceKm(point.lat, point.lng, area.lat, area.lng)

export type EventArea = {
  id: number
  name: string
  lat: number
  lng: number
  radiusKm: number
  /** In the scope of the map (the obec, or the region's members) — not just a partner of one of its events. */
  inScope: boolean
}

export type EventAreaPoint = {
  id: number
  title: string
  dateTime: string
  locationText: string | null
  lat: number
  lng: number
  /** From the nearest obec taking part in the event, in km. */
  distanceKm: number
  /** The obec that distance is measured from. */
  nearestObec: string
  outside: boolean
  /** The obec's own event, or one of a pořadatel (an organization of the obec). */
  runBy: 'obec' | 'organizer'
  organizationName: string | null
  /** Standalone — one obec's — or mikroregionální, co-organized by another obec. */
  kind: 'standalone' | 'regional'
  /** The obec the event is filed under. */
  homeObec: string
  /** The other obce taking part (empty when standalone). */
  partners: string[]
}

export type EventAreaMap = {
  /** What the map is of: an obec, or a mikroregion. */
  title: string
  areas: EventArea[]
  events: EventAreaPoint[]
}

type Circle = { id: string; name: string; lat: number; lng: number; radiusKm: number }

type Participating = {
  id: number
  municipality?: unknown
  coOrganizations?: unknown[] | null
}

/** The obce taking part in each event — the one it's filed under and the obce among its
 * spolupořadatelé — with where they are and how far their radius reaches. */
async function resolveParticipants(payload: Payload, events: Participating[]) {
  const coIds = [
    ...new Set(
      events.flatMap((e) => ((e.coOrganizations ?? []) as unknown[]).map(relationId)).filter((id): id is string => id !== null),
    ),
  ]
  const obecOrganizations = coIds.length
    ? await payload.find({
        collection: 'organizations',
        where: { and: [{ id: { in: coIds.map(Number) } }, { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }] },
        select: { municipality: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    : { docs: [] }
  const obecOfOrganization = new Map(
    obecOrganizations.docs.map((o) => [String(o.id), relationId(o.municipality)] as const).filter((p): p is [string, string] => p[1] !== null),
  )

  const byEvent = new Map<number, { home: string | null; partners: string[] }>()
  const municipalityIds = new Set<string>()
  for (const e of events) {
    const home = relationId(e.municipality)
    const partners = [
      ...new Set(
        ((e.coOrganizations ?? []) as unknown[])
          .map((o) => obecOfOrganization.get(relationId(o) ?? ''))
          .filter((id): id is string => Boolean(id) && id !== home),
      ),
    ]
    byEvent.set(e.id, { home, partners })
    if (home) municipalityIds.add(home)
    for (const p of partners) municipalityIds.add(p)
  }

  const municipalities = municipalityIds.size
    ? await payload.find({
        collection: 'municipalities',
        where: { id: { in: [...municipalityIds].map(Number) } },
        select: { name: true, lat: true, lng: true, eventRadiusKm: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    : { docs: [] }
  const circles = new Map<string, Circle>(
    municipalities.docs.map((m) => [String(m.id), { id: String(m.id), name: m.name, lat: m.lat, lng: m.lng, radiusKm: radiusOf(m) }]),
  )
  return { byEvent, circles }
}

/** Where `point` lies against the obce taking part: the one it's nearest to (by how far it is past
 * the radius), its distance from there, and whether it's within any of the radii. */
function judge(point: { lat: number; lng: number }, taking: Circle[]) {
  let best: { circle: Circle; distanceKm: number } | null = null
  for (const circle of taking) {
    const distanceKm = distanceFromObecKm(point, circle)
    if (!best || distanceKm - circle.radiusKm < best.distanceKm - best.circle.radiusKm) best = { circle, distanceKm }
  }
  return best && { ...best, outside: best.distanceKm > best.circle.radiusKm }
}

/** The published events that haven't ended yet of the given obce — those filed under them and those
 * they co-organize — against the radii, for the superadmin's map of an obec or a mikroregion. */
async function eventAreaMapOfObce(payload: Payload, title: string, scopeIds: number[], now: Date): Promise<EventAreaMap> {
  const nowIso = now.toISOString()
  const scopeOrganizations = await payload.find({
    collection: 'organizations',
    where: { and: [{ municipality: { in: scopeIds } }, { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }] },
    select: { name: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const scopeOrganizationIds = scopeOrganizations.docs.map((o) => o.id)

  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        {
          or: [
            { municipality: { in: scopeIds } },
            ...(scopeOrganizationIds.length ? [{ coOrganizations: { in: scopeOrganizationIds } }] : []),
          ],
        },
        { isDraft: { not_equals: true } },
        { deletedAt: { exists: false } },
        { status: { not_equals: 'cancelled' } },
        {
          or: [
            { endDateTime: { greater_than_equal: nowIso } },
            { and: [{ endDateTime: { exists: false } }, { dateTime: { greater_than_equal: nowIso } }] },
          ],
        },
      ],
    },
    select: { title: true, dateTime: true, endDateTime: true, locationText: true, lat: true, lng: true, organization: true, municipality: true, coOrganizations: true },
    sort: 'dateTime',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const located = events.docs.filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')

  const organizationIds = [...new Set(located.map((e) => relationId(e.organization)).filter((id): id is string => id !== null))]
  const organizations = organizationIds.length
    ? await payload.find({
        collection: 'organizations',
        where: { id: { in: organizationIds.map(Number) } },
        select: { name: true, type: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    : { docs: [] }
  const organizationById = new Map(organizations.docs.map((o) => [String(o.id), o]))

  const { byEvent, circles } = await resolveParticipants(payload, located)
  const scope = new Set(scopeIds.map(String))
  // Every scope obec is drawn (even with no events); partners from outside the scope too.
  const scopeCircles = await payload.find({
    collection: 'municipalities',
    where: { id: { in: scopeIds } },
    select: { name: true, lat: true, lng: true, eventRadiusKm: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const m of scopeCircles.docs) {
    circles.set(String(m.id), { id: String(m.id), name: m.name, lat: m.lat, lng: m.lng, radiusKm: radiusOf(m) })
  }

  const points: EventAreaPoint[] = []
  for (const e of located) {
    const parties = byEvent.get(e.id)!
    const taking = [parties.home, ...parties.partners].map((id) => circles.get(id ?? '')).filter((c): c is Circle => Boolean(c))
    const verdict = judge({ lat: e.lat!, lng: e.lng! }, taking)
    if (!verdict) continue
    const organization = organizationById.get(relationId(e.organization) ?? '')
    points.push({
      id: e.id,
      title: e.title,
      dateTime: e.dateTime,
      locationText: e.locationText ?? null,
      lat: e.lat!,
      lng: e.lng!,
      distanceKm: Math.round(verdict.distanceKm * 10) / 10,
      nearestObec: verdict.circle.name,
      outside: verdict.outside,
      runBy: organization?.type === MUNICIPALITY_ORGANIZATION_TYPE ? 'obec' : 'organizer',
      organizationName: organization?.name ?? null,
      kind: parties.partners.length > 0 ? 'regional' : 'standalone',
      homeObec: circles.get(parties.home ?? '')?.name ?? '',
      partners: parties.partners.map((id) => circles.get(id)?.name).filter((n): n is string => Boolean(n)),
    })
  }

  const shown = new Set<string>(scope)
  for (const e of located) for (const id of byEvent.get(e.id)!.partners) shown.add(id)
  const areas: EventArea[] = [...shown]
    .map((id) => circles.get(id))
    .filter((c): c is Circle => Boolean(c))
    .map((c) => ({ id: Number(c.id), name: c.name, lat: c.lat, lng: c.lng, radiusKm: c.radiusKm, inScope: scope.has(c.id) }))
  return { title, areas, events: points }
}

/** The obec's published, coming events — its own, its pořadatelé's and those it co-organizes with
 * another obec — against the contractual radii: the superadmin's map of the obec. */
export async function eventAreaMapOf(payload: Payload, municipalityId: number, now = new Date()): Promise<EventAreaMap> {
  const municipality = await payload.findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true, select: { name: true } })
  return eventAreaMapOfObce(payload, municipality.name, [municipalityId], now)
}

/** The same for all obce of a mikroregion — the superadmin's map of the region. */
export async function eventAreaMapOfRegion(payload: Payload, microregionId: number, now = new Date()): Promise<EventAreaMap> {
  const region = await payload.findByID({ collection: 'microregions', id: microregionId, depth: 0, overrideAccess: true, select: { name: true, municipalities: true } })
  const members = ((region.municipalities ?? []) as unknown[]).map(relationId).filter((id): id is string => id !== null).map(Number)
  return eventAreaMapOfObce(payload, region.name, members, now)
}

type WatchedEvent = {
  id: number
  title: string
  lat?: number | null
  lng?: number | null
  municipality?: unknown
  organization?: unknown
  coOrganizations?: unknown[] | null
  isDraft?: boolean | null
  deletedAt?: string | null
  status?: string | null
  dateTime?: string | null
  endDateTime?: string | null
}

const sortedIds = (list: unknown[] | null | undefined): string =>
  (list ?? []).map(relationId).filter((id): id is string => id !== null).sort().join(',')

/**
 * Whether this save puts a published, coming event outside the radius anew — created, moved, filed
 * under another obec, with other co-organizing obce, or published from a draft. An event that was
 * outside already and is only edited (a new title) isn't reported again.
 */
export function needsAreaCheck(doc: WatchedEvent, previous: WatchedEvent | undefined, operation: 'create' | 'update'): boolean {
  if (doc.isDraft || doc.deletedAt || doc.status === 'cancelled') return false
  if (hasEventEnded(doc.dateTime, doc.endDateTime)) return false
  if (operation === 'create' || !previous) return true
  return (
    doc.lat !== previous.lat ||
    doc.lng !== previous.lng ||
    relationId(doc.municipality) !== relationId(previous.municipality) ||
    sortedIds(doc.coOrganizations) !== sortedIds(previous.coOrganizations) ||
    (Boolean(previous.isDraft) && !doc.isDraft)
  )
}

/** Tells the platform team (Discord / e-mail, lib/alerts/ops) about a published event outside the
 * radius of every obec taking part in it. Never throws. */
export async function alertIfOutsideArea(payload: Payload, doc: WatchedEvent): Promise<boolean> {
  const municipalityId = relationId(doc.municipality)
  if (!municipalityId || typeof doc.lat !== 'number' || typeof doc.lng !== 'number') return false
  try {
    const { byEvent, circles } = await resolveParticipants(payload, [{ id: doc.id, municipality: doc.municipality, coOrganizations: doc.coOrganizations }])
    const parties = byEvent.get(doc.id)!
    const taking = [parties.home, ...parties.partners].map((id) => circles.get(id ?? '')).filter((c): c is Circle => Boolean(c))
    const verdict = judge({ lat: doc.lat, lng: doc.lng }, taking)
    if (!verdict?.outside) return false
    const home = circles.get(municipalityId)
    const regional = parties.partners.length > 0

    const organizationId = relationId(doc.organization)
    const organization = organizationId
      ? await payload
          .findByID({ collection: 'organizations', id: Number(organizationId), depth: 0, overrideAccess: true, select: { name: true, type: true } })
          .catch(() => null)
      : null
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
    const obceNames = taking.map((c) => c.name).join(', ')
    return await sendOpsAlert({
      key: `event-outside-area:${doc.id}`,
      severity: 'warning',
      title: regional ? `Mikroregionální akce mimo okruh obcí ${obceNames}` : `Akce mimo smluvní okruh obce ${home?.name ?? municipalityId}`,
      details: {
        akce: `${doc.title} (#${doc.id})`,
        druh: regional ? `mikroregionální (${obceNames})` : 'samostatná',
        obec: `${home?.name ?? '?'} (#${municipalityId})`,
        vzdálenost: `${verdict.distanceKm.toFixed(1)} km od obce ${verdict.circle.name} (okruh ${verdict.circle.radiusKm} km)`,
        pořádá: organization
          ? `${organization.name}${organization.type === MUNICIPALITY_ORGANIZATION_TYPE ? ' (obec)' : ''}`
          : null,
        mapa: appUrl ? `${appUrl}/superadmin/obce/${municipalityId}` : null,
        detail: appUrl ? `${appUrl}/akce/${doc.id}` : null,
      },
    })
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'events.area_check_failed', eventId: doc.id, error: String(error) }))
    return false
  }
}
