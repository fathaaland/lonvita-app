import { NextResponse } from 'next/server'

import { fetchNominatim, geocodeAttribution, nominatimProxyRetryAfter } from '@/lib/geo/nominatim'

/**
 * Server-side proxy for OpenStreetMap Nominatim search (brief §12 "ROZHODNĚ NE NAPSAT
 * LOKACI" — the map picker's address search). Proxied rather than called directly from the
 * browser so we can set a proper identifying User-Agent, per Nominatim's usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/) — browsers don't let JS set that
 * header, and an unidentified client risks being rate-limited or blocked outright.
 */
export const runtime = 'nodejs'

type NominatimResult = {
  lat: string
  lon: string
  display_name: string
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  // The provider's credit rides along with every answer — the picker shows it from the moment it opens
  // (it asks with an empty query, which never reaches the provider).
  const attribution = geocodeAttribution()
  // No address is longer than this; anything that is isn't a search worth forwarding.
  if (!q || q.length < 3 || q.length > 200) {
    return NextResponse.json({ results: [], attribution })
  }

  const retryAfter = await nominatimProxyRetryAfter(request)
  if (retryAfter !== null) {
    return NextResponse.json({ results: [], attribution }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  }

  const data = await fetchNominatim<NominatimResult[]>(
    'search',
    {
      q,
      format: 'json',
      limit: '5',
      // Lonvita is a Czech civic-events platform — biasing results to CZ matches every real use.
      countrycodes: 'cz',
    },
    // Nominatim's public instance is a shared free resource — cache briefly so repeated
    // keystrokes for the same query don't all hit it.
    { revalidateSeconds: 60 },
  )
  if (!data) return NextResponse.json({ results: [], attribution })

  return NextResponse.json({
    results: data.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name })),
    attribution,
  })
}
