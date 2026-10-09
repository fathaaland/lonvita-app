import { consumeRateLimit, getClientIp } from '@/lib/security/rate-limit'

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'

/** Search and reverse lookups together, per client IP. A debounced search plus dragging the pin
 * around stays well inside it. */
const NOMINATIM_PROXY_RATE_LIMIT = { max: 60, windowSeconds: 60 }

/**
 * Both proxies are open to signed-out visitors, and everything they forward reaches Nominatim
 * under our User-Agent — one client pushing a script through them would get the app's address
 * search blocked for everybody. Returns the seconds to wait, or null when the call may go ahead.
 */
export async function nominatimProxyRetryAfter(request: Request): Promise<number | null> {
  const result = await consumeRateLimit({
    namespace: 'geocode',
    identifier: getClientIp(request.headers),
    ...NOMINATIM_PROXY_RATE_LIMIT,
  })
  return result.allowed ? null : result.retryAfter
}

/**
 * Fetches from OpenStreetMap Nominatim with a proper identifying User-Agent, per Nominatim's
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/) — browsers don't let
 * JS set that header, and an unidentified client risks being rate-limited or blocked outright,
 * so this must run server-side. Returns null on any failure so callers can fall back to an
 * empty result instead of erroring.
 */
export async function fetchNominatim<T>(
  path: 'search' | 'reverse',
  params: Record<string, string>,
  options?: { revalidateSeconds?: number },
): Promise<T | null> {
  const url = new URL(`${NOMINATIM_BASE_URL}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Lonvita/1.0 (civic events platform; contact via app)',
        'Accept-Language': 'cs',
      },
      ...(options?.revalidateSeconds != null ? { next: { revalidate: options.revalidateSeconds } } : {}),
    })
    if (!res.ok) return null

    return (await res.json()) as T
  } catch {
    return null
  }
}
