// @vitest-environment node
//
// Not jsdom (the suite-wide default): Payload signs a JWT at the end of resetPassword, and
// jose's `instanceof Uint8Array` check fails against jsdom's swapped-in globals — the reset
// would look broken here while working perfectly in the app.

import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { resetPasswordAction } from '@/lib/actions/auth/reset-password'

// A reset link is a bearer credential sitting in someone's inbox: it has to stop working the
// moment it's been used, and it has to stop working on its own after an hour.

let payload: Payload
let account: { id: number; email: string }

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000

/** Rate limiting keys on the client IP (5 attempts / 15 min), so each case gets its own. */
const headersFrom = (ip: string) => ({
  get: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? ip : null),
})

const issueToken = async (): Promise<string> => {
  const token = await payload.forgotPassword({
    collection: 'users',
    overrideAccess: true,
    disableEmail: true,
    data: { email: account.email },
  })
  if (!token) throw new Error('forgotPassword returned no token')
  return token
}

/** The raw row — `resetPasswordToken`/`resetPasswordExpiration` are auth internals that never
 * come back through the normal read API. */
const rawUser = async (): Promise<{ resetPasswordToken?: string | null; resetPasswordExpiration?: string | null }> =>
  (await payload.db.findOne({
    collection: 'users',
    where: { id: { equals: account.id } },
  })) as never

describe('Password reset links', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    account = await payload.create({
      collection: 'users',
      data: { email: `reset-${STAMP}@test.local`, password: 'original-password', role: 'user' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', id: account.id, overrideAccess: true }).catch(() => {})
  })

  it('is valid for one hour', async () => {
    await issueToken()

    const expiration = new Date((await rawUser()).resetPasswordExpiration ?? 0).getTime()
    const validFor = expiration - Date.now()

    expect(validFor).toBeGreaterThan(55 * 60 * 1000)
    expect(validFor).toBeLessThanOrEqual(HOUR)
  })

  it('works once and is refused every time after that', async () => {
    const token = await issueToken()

    const first = await resetPasswordAction({
      token,
      password: 'brand-new-password',
      requestHeaders: headersFrom(`10.0.0.${STAMP % 200}`),
    })
    expect(first).toEqual({ success: true })

    const second = await resetPasswordAction({
      token,
      password: 'attacker-chosen-password',
      requestHeaders: headersFrom(`10.0.1.${STAMP % 200}`),
    })
    expect(second.success).toBe(false)
  })

  it('leaves no usable token on the account once it has been used', async () => {
    const token = await issueToken()

    await resetPasswordAction({
      token,
      password: 'another-new-password',
      requestHeaders: headersFrom(`10.0.2.${STAMP % 200}`),
    })

    expect((await rawUser()).resetPasswordToken).toBeFalsy()
  })

  it('refuses a token that has run past its hour', async () => {
    const token = await issueToken()
    await payload.db.updateOne({
      collection: 'users',
      where: { id: { equals: account.id } },
      data: { resetPasswordExpiration: new Date(Date.now() - 1000).toISOString() },
    })

    const result = await resetPasswordAction({
      token,
      password: 'too-late-password',
      requestHeaders: headersFrom(`10.0.3.${STAMP % 200}`),
    })

    expect(result.success).toBe(false)
  })

  it('invalidates an older link as soon as a new one is requested', async () => {
    const firstToken = await issueToken()
    const secondToken = await issueToken()
    expect(secondToken).not.toBe(firstToken)

    const result = await resetPasswordAction({
      token: firstToken,
      password: 'superseded-password',
      requestHeaders: headersFrom(`10.0.4.${STAMP % 200}`),
    })

    expect(result.success).toBe(false)
  })
})
