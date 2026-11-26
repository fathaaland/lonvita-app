import { consumeRateLimit, getClientIp } from '@/lib/security/rate-limit'

const PUBLIC_INSTANCE = 'https://nominatim.openstreetmap.org'

/** The public OpenStreetMap instance unless NOMINATIM_BASE_URL names another — a hosted provider
 * with Nominatim's API (LocationIQ: https://eu1.locationiq.com/v1) or one's own. The public one's
 * usage policy, like the tiles', isn't meant for production traffic. Read per call, not at import. */
const baseUrl = () => process.env.NOMINATIM_BASE_URL?.trim().replace(/\/+$/, '') || PUBLIC_INSTANCE

/**
 * Lookups a second across the whole app — every web function and import job, shared through Redis.
 * The public instance allows one; a hosted provider as many as its plan does (NOMINATIM_RATE_PER_SECOND),
 * so a burst of visitors searching at once is spread out instead of answered with the provider's 429.
 * Unset for a hosted provider = no cap of our own.
 */
const ratePerSecond = (): number | null => {
  const parsed = Number(process.env.NOMINATIM_RATE_PER_SECOND)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  return baseUrl() === PUBLIC_INSTANCE ? 1 : null
}

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

async function takeNominatimSlot(max: number, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_100))
    const slot = await consumeRateLimit({
      namespace: 'nominatim-global',
      identifier: 'all',
      max,
      windowSeconds: 1,
    })
    if (slot.allowed) return true
  }
  return false
}

/**
 * Fetches from Nominatim (or a provider with its API) with a proper identifying User-Agent, per
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/) — browsers don't
 * let JS set that header, and an unidentified client risks being rate-limited or blocked outright.
 * Server-side also because a hosted provider's NOMINATIM_API_KEY (sent as `key`, LocationIQ's name for
 * it) must never reach the browser. Returns null on any failure so callers can fall back to an empty
 * result instead of erroring.
 */
export async function fetchNominatim<T>(
  path: 'search' | 'reverse',
  params: Record<string, string>,
  options?: { revalidateSeconds?: number; waitForSlot?: boolean },
): Promise<T | null> {
  // The app's share of the provider's rate (ratePerSecond) — not per visitor. A visitor's lookup over
  // it comes back empty (callers already handle that); a background import waits for its turn.
  const max = ratePerSecond()
  if (max !== null && !(await takeNominatimSlot(max, options?.waitForSlot ? 30 : 1))) return null

  const url = new URL(`${baseUrl()}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  // Both Nominatim and the hosted providers read the language as a parameter too.
  url.searchParams.set('accept-language', 'cs')
  const apiKey = process.env.NOMINATIM_API_KEY?.trim()
  if (apiKey) url.searchParams.set('key', apiKey)

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

export type GeocodeAttribution = { label: string; href: string }

/**
 * The credit the address search's provider asks for next to it — LocationIQ's free plan allows
 * commercial use only with a visible "Search by LocationIQ.com" link back in this exact wording.
 * Null for providers that ask for nothing beyond the map's own OpenStreetMap credit.
 */
export function geocodeAttribution(): GeocodeAttribution | null {
  try {
    if (new URL(baseUrl()).hostname.endsWith('locationiq.com'))
      return { label: 'Search by LocationIQ.com', href: 'https://locationiq.com' }
  } catch {
    // A malformed NOMINATIM_BASE_URL — nothing to credit, and fetchNominatim fails on its own.
  }
  return null
}
