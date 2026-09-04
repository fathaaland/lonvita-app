import { NextResponse } from 'next/server'

/** Reverse-geocode proxy — turns a pin dropped/dragged on the map into a human-readable
 * label for the event's `locationText` field. Same rationale as /api/geocode (server-side so
 * we can set a proper User-Agent per Nominatim's usage policy). */
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  if (!lat || !lng) {
    return NextResponse.json({ label: null })
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', lat)
  url.searchParams.set('lon', lng)
  url.searchParams.set('format', 'json')

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Lonvita/1.0 (civic events platform; contact via app)',
        'Accept-Language': 'cs',
      },
    })
    if (!res.ok) return NextResponse.json({ label: null })

    const data = (await res.json()) as { display_name?: string }
    return NextResponse.json({ label: data.display_name ?? null })
  } catch {
    return NextResponse.json({ label: null })
  }
}
