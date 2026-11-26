import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchNominatim, geocodeAttribution } from '@/lib/geo/nominatim'

// Nothing here reaches the network: fetch is stubbed, only the request it would make is checked.
const stubFetch = () => {
  const calls: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      calls.push(new URL(url))
      return new Response(JSON.stringify([{ lat: '49.4', lon: '15.2', display_name: 'Pelhřimov' }]), { status: 200 })
    }),
  )
  return calls
}

describe('Address search — a hosted provider with Nominatim’s API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('goes to the configured provider with its key, in Czech', async () => {
    vi.stubEnv('NOMINATIM_BASE_URL', 'https://eu1.locationiq.com/v1/')
    vi.stubEnv('NOMINATIM_API_KEY', 'pk.test-key')
    vi.stubEnv('NOMINATIM_RATE_PER_SECOND', '1000')
    const calls = stubFetch()

    const results = await fetchNominatim<{ lat: string }[]>('search', { q: 'Pelhřimov', format: 'json' })

    expect(results?.[0]?.lat).toBe('49.4')
    expect(calls).toHaveLength(1)
    expect(`${calls[0].origin}${calls[0].pathname}`).toBe('https://eu1.locationiq.com/v1/search')
    expect(calls[0].searchParams.get('key')).toBe('pk.test-key')
    expect(calls[0].searchParams.get('accept-language')).toBe('cs')
    expect(calls[0].searchParams.get('q')).toBe('Pelhřimov')
  })

  it('sends no key to the public instance', async () => {
    vi.stubEnv('NOMINATIM_BASE_URL', '')
    vi.stubEnv('NOMINATIM_API_KEY', '')
    vi.stubEnv('NOMINATIM_RATE_PER_SECOND', '1000')
    const calls = stubFetch()

    await fetchNominatim('reverse', { lat: '49.4', lon: '15.2', format: 'json' })

    expect(calls[0].origin).toBe('https://nominatim.openstreetmap.org')
    expect(calls[0].searchParams.has('key')).toBe(false)
  })

  it('credits LocationIQ with the link its free plan requires, nobody else', () => {
    vi.stubEnv('NOMINATIM_BASE_URL', 'https://eu1.locationiq.com/v1')
    expect(geocodeAttribution()).toEqual({ label: 'Search by LocationIQ.com', href: 'https://locationiq.com' })
    vi.stubEnv('NOMINATIM_BASE_URL', '')
    expect(geocodeAttribution()).toBeNull()
  })

  it('holds the whole app to the plan’s rate — a lookup over it comes back empty', async () => {
    vi.stubEnv('NOMINATIM_BASE_URL', 'https://eu1.locationiq.com/v1')
    vi.stubEnv('NOMINATIM_RATE_PER_SECOND', '2')
    const calls = stubFetch()

    const answers = await Promise.all([1, 2, 3, 4].map(() => fetchNominatim('search', { q: 'Humpolec' })))

    expect(answers.filter((answer) => answer === null).length).toBeGreaterThanOrEqual(2)
    expect(calls.length).toBeLessThanOrEqual(2)
  })
})
