import { NextResponse } from 'next/server'

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
  if (!q || q.length < 3) {
    return NextResponse.json({ results: [] })
  }

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '5')
  // Lonvita is a Czech civic-events platform — biasing results to CZ matches every real use.
  url.searchParams.set('countrycodes', 'cz')

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Lonvita/1.0 (civic events platform; contact via app)',
        'Accept-Language': 'cs',
      },
      // Nominatim's public instance is a shared free resource — cache briefly so repeated
      // keystrokes for the same query don't all hit it.
      next: { revalidate: 60 },
    })
    if (!res.ok) return NextResponse.json({ results: [] })

    const data = (await res.json()) as NominatimResult[]
    return NextResponse.json({
      results: data.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name })),
    })
  } catch {
    return NextResponse.json({ results: [] })
  }
}
