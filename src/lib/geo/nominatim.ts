import { consumeRateLimit, getClientIp } from '@/lib/security/rate-limit'

/** The public OpenStreetMap instance unless NOMINATIM_BASE_URL names another (a hosted provider or
 * one's own) — its usage policy, like the tiles', isn't meant for heavy production traffic. */
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL?.trim().replace(/\/+$/, '') ||
  'https://nominatim.openstreetmap.org'

const USING_PUBLIC_INSTANCE = NOMINATIM_BASE_URL === 'https://nominatim.openstreetmap.org'

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

async function takeNominatimSlot(attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_100))
    const slot = await consumeRateLimit({
      namespace: 'nominatim-global',
      identifier: 'all',
      max: 1,
      windowSeconds: 1,
    })
    if (slot.allowed) return true
  }
  return false
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
  options?: { revalidateSeconds?: number; waitForSlot?: boolean },
): Promise<T | null> {
  // The public instance allows one request per second from the whole app, not per visitor —
  // shared through Redis across the web functions and import jobs. A visitor's lookup over that
  // comes back empty (callers already handle that); a background import waits for its turn.
  if (USING_PUBLIC_INSTANCE && !(await takeNominatimSlot(options?.waitForSlot ? 30 : 1)))
    return null

  const url = new URL(`${NOMINATIM_BASE_URL}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Lonvita/1.0 (civic events platform; contact via app)',
        'Accept-Language': 'cs',
      },
      ...(options?.revalidateSeconds != null
        ? { next: { revalidate: options.revalidateSeconds } }
        : {}),
    })
    if (!res.ok) return null

    return (await res.json()) as T
  } catch {
    return null
  }
}
