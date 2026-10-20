import { haversineDistanceKm } from '@/lib/geo/distance'
import { fetchNominatim } from '@/lib/geo/nominatim'
import { consumeRateLimit } from '@/lib/security/rate-limit'

import { normalizeText } from './normalize'

export type MunicipalityArea = { name: string; lat: number; lng: number; eventRadiusKm: number }

export type Point = { lat: number; lng: number }

/** Looks a free-text place up within the area — null when nothing is found. */
export type GeocodeFn = (query: string, area: MunicipalityArea) => Promise<Point | null>

export const isWithinArea = (point: Point, area: MunicipalityArea): boolean =>
  haversineDistanceKm(point.lat, point.lng, area.lat, area.lng) <= area.eventRadiusKm

/** Nominatim allows one request a second for the whole application — shared through Redis, since
 * several import jobs may run at once. */
async function waitForNominatimSlot(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const slot = await consumeRateLimit({
      namespace: 'nominatim-import',
      identifier: 'all',
      max: 1,
      windowSeconds: 1,
    })
    if (slot.allowed) return
    await new Promise((resolve) => setTimeout(resolve, 1_100))
  }
}

/** The OpenStreetMap lookup, bounded to a box around the obec's area. */
export const geocodeWithNominatim: GeocodeFn = async (query, area) => {
  const latDelta = area.eventRadiusKm / 111
  const lngDelta = area.eventRadiusKm / (111 * Math.cos((area.lat * Math.PI) / 180))
  await waitForNominatimSlot()
  const results = await fetchNominatim<{ lat: string; lon: string }[]>('search', {
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'cz',
    viewbox: `${area.lng - lngDelta},${area.lat + latDelta},${area.lng + lngDelta},${area.lat - latDelta}`,
    bounded: '1',
  })
  const first = results?.[0]
  if (!first) return null
  const point = { lat: Number(first.lat), lng: Number(first.lon) }
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null
}

export type LocateResult =
  { point: Point } | { warning: 'location_missing' | 'location_not_found' | 'outside_radius' }

/**
 * Where the event takes place, inside the obec's area: the coordinates the source gives, a place an
 * earlier event of the obec was already pinned to under the same name, or a lookup — the place with
 * its address, the address alone, the place alone, each "…, <obec>". Lookups are cached for the run.
 */
export async function locateEvent(
  place: {
    locationName: string | null
    address: string | null
    locationText: string | null
    lat?: number | null
    lng?: number | null
  },
  area: MunicipalityArea,
  {
    geocode,
    knownPlaces,
    cache,
  }: { geocode: GeocodeFn; knownPlaces: Map<string, Point>; cache: Map<string, Point | null> },
): Promise<LocateResult> {
  if (place.lat != null && place.lng != null) {
    const point = { lat: place.lat, lng: place.lng }
    if (isWithinArea(point, area)) return { point }
  }
  if (!place.locationText) return { warning: 'location_missing' }

  for (const name of [place.locationText, place.locationName]) {
    const known = name ? knownPlaces.get(normalizeText(name)) : undefined
    if (known && isWithinArea(known, area)) return { point: known }
  }

  const queries = [
    place.locationName && place.address ? `${place.locationName}, ${place.address}` : null,
    place.address,
    place.locationName,
  ]
    .filter((q): q is string => Boolean(q?.trim()))
    .map((q) => (normalizeText(q).includes(normalizeText(area.name)) ? q : `${q}, ${area.name}`))

  let foundOutside = false
  for (const query of [...new Set(queries)]) {
    const key = normalizeText(query)
    let point = cache.get(key)
    if (point === undefined) {
      point = await geocode(query, area)
      cache.set(key, point)
    }
    if (!point) continue
    if (isWithinArea(point, area)) return { point }
    foundOutside = true
  }
  return { warning: foundOutside ? 'outside_radius' : 'location_not_found' }
}
