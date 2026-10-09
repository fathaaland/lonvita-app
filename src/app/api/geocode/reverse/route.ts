import { NextResponse } from 'next/server'

import { fetchNominatim, nominatimProxyRetryAfter } from '@/lib/geo/nominatim'

/** Reverse-geocode proxy — turns a pin dropped/dragged on the map into a human-readable
 * label for the event's `locationText` field. Same rationale as /api/geocode (server-side so
 * we can set a proper User-Agent per Nominatim's usage policy). */
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat') || NaN)
  const lng = Number(searchParams.get('lng') || NaN)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ label: null })
  }

  const retryAfter = await nominatimProxyRetryAfter(request)
  if (retryAfter !== null) {
    return NextResponse.json({ label: null }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  }

  const data = await fetchNominatim<{ display_name?: string }>('reverse', {
    lat: String(lat),
    lon: String(lng),
    format: 'json',
  })
  return NextResponse.json({ label: data?.display_name ?? null })
}
