import { afterEach, describe, expect, it, vi } from 'vitest'

import { consumeRateLimit } from '@/lib/security/rate-limit'

/** A store whose counter is already at `count` — so the limit decides. */
const storeAt = (count: number) => ({ eval: vi.fn(async () => [count, 60]) }) as never

const hit = (count: number) =>
  consumeRateLimit({ namespace: 'test', identifier: 'ip', max: 20, windowSeconds: 60, store: storeAt(count) })

describe('RATE_LIMIT_MULTIPLIER (load tests only)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('changes nothing when it is not set', async () => {
    expect((await hit(21)).allowed).toBe(false)
  })

  it('raises the limit on a Vercel preview', async () => {
    vi.stubEnv('RATE_LIMIT_MULTIPLIER', '100')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await hit(21)).allowed).toBe(true)
    expect((await hit(2001)).allowed).toBe(false)
  })

  it('is ignored on the production deployment, whatever the variable says', async () => {
    vi.stubEnv('RATE_LIMIT_MULTIPLIER', '100')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await hit(21)).allowed).toBe(false)
  })

  it('is ignored in a production build that is not a preview', async () => {
    vi.stubEnv('RATE_LIMIT_MULTIPLIER', '100')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', '')
    expect((await hit(21)).allowed).toBe(false)
  })
})
