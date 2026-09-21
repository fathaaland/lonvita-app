import { NextResponse } from 'next/server';
import { fetchNominatim } from '@/lib/geo/nominatim';
/** Reverse-geocode proxy — turns a pin dropped/dragged on the map into a human-readable
 * label for the event's `locationText` field. Same rationale as /api/geocode (server-side so
 * we can set a proper User-Agent per Nominatim's usage policy). */
export const runtime = 'nodejs';
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    if (!lat || !lng) {
        return NextResponse.json({ label: null });
    }
    const data = await fetchNominatim('reverse', { lat, lon: lng, format: 'json' });
    return NextResponse.json({ label: data?.display_name ?? null });
}
