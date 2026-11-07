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
 */

export const DEFAULT_EVENT_RADIUS_KM = 15

type Area = { lat: number; lng: number; eventRadiusKm?: number | null }

export const radiusOf = (area: Pick<Area, 'eventRadiusKm'>): number => area.eventRadiusKm ?? DEFAULT_EVENT_RADIUS_KM

export const distanceFromObecKm = (point: { lat: number; lng: number }, area: Area): number =>
  haversineDistanceKm(point.lat, point.lng, area.lat, area.lng)

export type EventAreaPoint = {
  id: number
  title: string
  dateTime: string
  locationText: string | null
  lat: number
  lng: number
  distanceKm: number
  outside: boolean
  /** The obec's own event, or one of a pořadatel (an organization of the obec). */
  runBy: 'obec' | 'organizer'
  organizationName: string | null
}

export type EventAreaMap = {
  municipality: { id: number; name: string; lat: number; lng: number; radiusKm: number }
  events: EventAreaPoint[]
}

/** The obec's published events that haven't ended yet — what the superadmin's map shows. */
export async function eventAreaMapOf(payload: Payload, municipalityId: number, now = new Date()): Promise<EventAreaMap> {
  const municipality = await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
    select: { name: true, lat: true, lng: true, eventRadiusKm: true },
  })
  const radiusKm = radiusOf(municipality)
  const nowIso = now.toISOString()

  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
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
    select: { title: true, dateTime: true, endDateTime: true, locationText: true, lat: true, lng: true, organization: true },
    sort: 'dateTime',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const organizationIds = [
    ...new Set(events.docs.map((e) => relationId(e.organization)).filter((id): id is string => id !== null)),
  ]
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

  return {
    municipality: { id: municipality.id, name: municipality.name, lat: municipality.lat, lng: municipality.lng, radiusKm },
    events: events.docs
      .filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')
      .map((e) => {
        const organization = organizationById.get(relationId(e.organization) ?? '')
        const distanceKm = distanceFromObecKm({ lat: e.lat!, lng: e.lng! }, municipality)
        return {
          id: e.id,
          title: e.title,
          dateTime: e.dateTime,
          locationText: e.locationText ?? null,
          lat: e.lat!,
          lng: e.lng!,
          distanceKm: Math.round(distanceKm * 10) / 10,
          outside: distanceKm > radiusKm,
          runBy: organization?.type === MUNICIPALITY_ORGANIZATION_TYPE ? 'obec' : 'organizer',
          organizationName: organization?.name ?? null,
        }
      }),
  }
}

type WatchedEvent = {
  id: number
  title: string
  lat?: number | null
  lng?: number | null
  municipality?: unknown
  organization?: unknown
  isDraft?: boolean | null
  deletedAt?: string | null
  status?: string | null
  dateTime?: string | null
  endDateTime?: string | null
}

/**
 * Whether this save puts a published, coming event outside its obec's radius anew — created, moved,
 * filed under another obec, or published from a draft. An event that was outside already and is
 * only edited (a new title) isn't reported again.
 */
export function needsAreaCheck(doc: WatchedEvent, previous: WatchedEvent | undefined, operation: 'create' | 'update'): boolean {
  if (doc.isDraft || doc.deletedAt || doc.status === 'cancelled') return false
  if (hasEventEnded(doc.dateTime, doc.endDateTime)) return false
  if (operation === 'create' || !previous) return true
  return (
    doc.lat !== previous.lat ||
    doc.lng !== previous.lng ||
    relationId(doc.municipality) !== relationId(previous.municipality) ||
    (Boolean(previous.isDraft) && !doc.isDraft)
  )
}

/** Tells the platform team (Discord / e-mail, lib/alerts/ops) about a published event outside the
 * obec's contractual radius. Never throws. */
export async function alertIfOutsideArea(payload: Payload, doc: WatchedEvent): Promise<boolean> {
  const municipalityId = relationId(doc.municipality)
  if (!municipalityId || typeof doc.lat !== 'number' || typeof doc.lng !== 'number') return false
  try {
    const municipality = await payload.findByID({
      collection: 'municipalities',
      id: Number(municipalityId),
      depth: 0,
      overrideAccess: true,
      select: { name: true, lat: true, lng: true, eventRadiusKm: true },
    })
    const radiusKm = radiusOf(municipality)
    const distanceKm = distanceFromObecKm({ lat: doc.lat, lng: doc.lng }, municipality)
    if (distanceKm <= radiusKm) return false

    const organizationId = relationId(doc.organization)
    const organization = organizationId
      ? await payload
          .findByID({ collection: 'organizations', id: Number(organizationId), depth: 0, overrideAccess: true, select: { name: true, type: true } })
          .catch(() => null)
      : null
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
    return await sendOpsAlert({
      key: `event-outside-area:${doc.id}`,
      severity: 'warning',
      title: `Akce mimo smluvní okruh obce ${municipality.name}`,
      details: {
        akce: `${doc.title} (#${doc.id})`,
        obec: `${municipality.name} (#${municipality.id})`,
        vzdálenost: `${distanceKm.toFixed(1)} km (okruh ${radiusKm} km)`,
        pořádá: organization
          ? `${organization.name}${organization.type === MUNICIPALITY_ORGANIZATION_TYPE ? ' (obec)' : ''}`
          : null,
        mapa: appUrl ? `${appUrl}/superadmin/obce/${municipality.id}` : null,
        detail: appUrl ? `${appUrl}/akce/${doc.id}` : null,
      },
    })
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'events.area_check_failed', eventId: doc.id, error: String(error) }))
    return false
  }
}
