const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
/**
 * Fetches from OpenStreetMap Nominatim with a proper identifying User-Agent, per Nominatim's
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/) — browsers don't let
 * JS set that header, and an unidentified client risks being rate-limited or blocked outright,
 * so this must run server-side. Returns null on any failure so callers can fall back to an
 * empty result instead of erroring.
 */
export async function fetchNominatim(path, params, options) {
    const url = new URL(`${NOMINATIM_BASE_URL}/${path}`);
    for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Lonvita/1.0 (civic events platform; contact via app)',
                'Accept-Language': 'cs',
            },
            ...(options?.revalidateSeconds != null ? { next: { revalidate: options.revalidateSeconds } } : {}),
        });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
}
