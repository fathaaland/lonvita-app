// @vitest-environment node
//
// Not jsdom (the suite-wide default): Payload signs a JWT at the end of resetPassword, and
// jose's `instanceof Uint8Array` check fails against jsdom's swapped-in globals — the reset
// would look broken here while working perfectly in the app.

import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

// The queue and Resend are the two things these tests don't talk to: the request's enqueue is
// captured and the worker's processor run on it directly, against the test database.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueuePasswordReset: vi.fn(async () => ({ id: 'job-1' })),
}))
vi.mock('../../worker/src/processors/email.processor', () => ({
  processEmailJob: vi.fn(async (data: { to: string }) => ({ messageId: 'msg-1', accepted: [data.to] })),
}))

import { forgotPasswordAction } from '@/lib/actions/auth/forgot-password'
import { resetPasswordAction } from '@/lib/actions/auth/reset-password'
import { enqueuePasswordReset } from '@/lib/queue/queues'

import { processEmailJob } from '../../worker/src/processors/email.processor'
import { processPasswordResetJob } from '../../worker/src/processors/password-reset.processor'

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

describe('Requesting a reset link', () => {
  const APP_URL = 'https://app.test'
  let requester: { id: number; email: string }

  const requestReset = (email: string, ip: string) =>
    forgotPasswordAction({ email, appUrl: APP_URL, requestHeaders: headersFrom(ip) })

  const rawRequester = async (): Promise<{ resetPasswordToken?: string | null }> =>
    (await payload.db.findOne({ collection: 'users', where: { id: { equals: requester.id } } })) as never

  beforeAll(async () => {
    payload ??= await getPayload({ config: await config })
    requester = await payload.create({
      collection: 'users',
      data: { email: `reset-request-${STAMP}@test.local`, password: 'original-password', role: 'user' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', id: requester.id, overrideAccess: true }).catch(() => {})
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does the same thing in the request whether or not the account exists — enqueue, nothing else', async () => {
    await requestReset(requester.email.toUpperCase(), `10.1.0.${STAMP % 200}`)
    await requestReset(`nobody-${STAMP}@test.local`, `10.1.1.${STAMP % 200}`)

    expect(vi.mocked(enqueuePasswordReset).mock.calls.map(([data]) => data)).toEqual([
      { email: requester.email, appUrl: APP_URL },
      { email: `nobody-${STAMP}@test.local`, appUrl: APP_URL },
    ])
    // The token is the worker's to mint.
    expect((await rawRequester()).resetPasswordToken).toBeFalsy()
  })

  it('queues nothing for an address that is not an e-mail', async () => {
    await requestReset('not-an-email', `10.1.2.${STAMP % 200}`)
    expect(vi.mocked(enqueuePasswordReset)).not.toHaveBeenCalled()
  })

  it('fails alike for every address when the queue is down', async () => {
    vi.mocked(enqueuePasswordReset).mockRejectedValue(new Error('valkey down'))
    await expect(requestReset(requester.email, `10.1.3.${STAMP % 200}`)).rejects.toThrow('valkey down')
    await expect(requestReset(`nobody-${STAMP}@test.local`, `10.1.4.${STAMP % 200}`)).rejects.toThrow('valkey down')
    vi.mocked(enqueuePasswordReset).mockResolvedValue({ id: 'job-1' } as never)
  })

  it('in the worker, e-mails a link that resets the password', async () => {
    const result = await processPasswordResetJob({ email: requester.email, appUrl: APP_URL }, { jobId: '9' })
    expect(result).toEqual({ sent: true, messageId: 'msg-1' })

    expect(vi.mocked(processEmailJob)).toHaveBeenCalledTimes(1)
    const [email, context] = vi.mocked(processEmailJob).mock.calls[0]
    expect(email.to).toBe(requester.email)
    expect(context).toEqual({ jobId: '9' })
    const token = decodeURIComponent(email.body.match(/reset-password\?token=([^"<\s]+)/)?.[1] ?? '')
    expect(email.body).toContain(`${APP_URL}/reset-password?token=`)

    const reset = await resetPasswordAction({
      token,
      password: 'password-from-the-email',
      requestHeaders: headersFrom(`10.1.5.${STAMP % 200}`),
    })
    expect(reset).toEqual({ success: true })
  })

  it('in the worker, sends nothing for an address with no account', async () => {
    const result = await processPasswordResetJob({ email: `nobody-${STAMP}@test.local`, appUrl: APP_URL })
    expect(result).toEqual({ sent: false, skipped: 'no_matching_account' })
    expect(vi.mocked(processEmailJob)).not.toHaveBeenCalled()
  })

  it('in the worker, fails the job (to be retried) when the e-mail does not go out', async () => {
    vi.mocked(processEmailJob).mockRejectedValueOnce(new Error('Resend error: nope'))
    await expect(processPasswordResetJob({ email: requester.email, appUrl: APP_URL })).rejects.toThrow('Resend error')
  })
})
