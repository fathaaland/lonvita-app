// @vitest-environment node
// The e-mail code a password sign-up enters in onboarding (lib/auth/email-verification), and the
// rule that onboarding can't be finished over the API without it.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import {
  checkEmailCode,
  EMAIL_CODE_MAX_ATTEMPTS,
  generateEmailCode,
  issueEmailCode,
  needsEmailVerification,
  normalizeEmailCode,
} from '@/lib/auth/email-verification'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role?: string | null; collection: 'users' }

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('E-mail code', () => {
  it('is six digits, leading zeros included', () => {
    for (let i = 0; i < 200; i++) expect(generateEmailCode()).toMatch(/^\d{6}$/)
  })

  it('accepts a pasted code with spaces, nothing else', () => {
    expect(normalizeEmailCode(' 123 456 ')).toBe('123456')
    expect(normalizeEmailCode('12345')).toBeNull()
    expect(normalizeEmailCode('12345a')).toBeNull()
    expect(normalizeEmailCode(123456)).toBeNull()
  })

  it('works once and only once', async () => {
    const userId = `test-once-${STAMP}`
    const code = await issueEmailCode(userId)
    expect(await checkEmailCode(userId, code)).toBe('ok')
    expect(await checkEmailCode(userId, code)).toBe('expired')
  })

  it('belongs to the account it was issued for', async () => {
    const code = await issueEmailCode(`test-owner-${STAMP}`)
    expect(await checkEmailCode(`test-other-${STAMP}`, code)).toBe('expired')
  })

  it('is replaced by a newer one', async () => {
    const userId = `test-replace-${STAMP}`
    const first = await issueEmailCode(userId)
    const second = await issueEmailCode(userId)
    if (first !== second) expect(await checkEmailCode(userId, first)).toBe('invalid')
    expect(await checkEmailCode(userId, second)).toBe('ok')
  })

  it(`dies after ${EMAIL_CODE_MAX_ATTEMPTS} wrong guesses — even the right one is refused afterwards`, async () => {
    const userId = `test-lock-${STAMP}`
    const code = await issueEmailCode(userId)
    for (let i = 1; i < EMAIL_CODE_MAX_ATTEMPTS; i++) {
      expect(await checkEmailCode(userId, wrongCode(code))).toBe('invalid')
    }
    expect(await checkEmailCode(userId, wrongCode(code))).toBe('locked')
    expect(await checkEmailCode(userId, code)).toBe('expired')
  })

  it("doesn't charge an attempt for a malformed code", async () => {
    const userId = `test-malformed-${STAMP}`
    const code = await issueEmailCode(userId)
    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS + 2; i++) expect(await checkEmailCode(userId, 'abc')).toBe('invalid')
    expect(await checkEmailCode(userId, code)).toBe('ok')
  })

  it('counts parallel guesses one by one', async () => {
    const userId = `test-parallel-${STAMP}`
    const code = await issueEmailCode(userId)
    const results = await Promise.all(
      Array.from({ length: EMAIL_CODE_MAX_ATTEMPTS * 2 }, () => checkEmailCode(userId, wrongCode(code))),
    )
    expect(results.filter((r) => r === 'invalid')).toHaveLength(EMAIL_CODE_MAX_ATTEMPTS - 1)
    expect(results.filter((r) => r === 'locked')).toHaveLength(1)
  })
})

describe('Finishing onboarding needs a verified e-mail', () => {
  let user: TestUser
  let profileId: number

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const created = await payload.create({
      collection: 'users',
      data: { email: `email-verify-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    user = { ...created, collection: 'users' }
    profileId = (
      await payload.create({
        collection: 'profiles',
        data: { user: created.id, fullName: 'Ověření E-mailu' },
        overrideAccess: true,
      })
    ).id
    await payload.create({
      collection: 'consents',
      data: { user: created.id, type: 'age_15_plus', version: '1.0', grantedAt: new Date().toISOString() },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    if (!user) return
    await payload.delete({ collection: 'consents', where: { user: { equals: user.id } }, overrideAccess: true })
    await payload.delete({ collection: 'profiles', where: { user: { equals: user.id } }, overrideAccess: true })
    await payload.delete({ collection: 'users', id: user.id, overrideAccess: true })
  })

  const finishOwn = () =>
    payload.update({
      collection: 'profiles',
      id: profileId,
      data: { onboardingCompleted: true },
      user,
      overrideAccess: false,
    })

  it('a fresh password account still needs it', async () => {
    const fresh = await payload.findByID({ collection: 'users', id: user.id, overrideAccess: true })
    expect(needsEmailVerification(fresh)).toBe(true)
  })

  it('is refused before the code', async () => {
    await expect(finishOwn()).rejects.toThrow(/ověřte svůj e-mail/)
  })

  it("can't be self-granted over the API", async () => {
    await payload
      .update({
        collection: 'users',
        id: user.id,
        data: { emailVerifiedAt: new Date().toISOString() },
        user,
        overrideAccess: false,
      })
      .catch(() => undefined)
    const after = await payload.findByID({ collection: 'users', id: user.id, overrideAccess: true })
    expect(after.emailVerifiedAt).toBeFalsy()
  })

  it('goes through once verified', async () => {
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { emailVerifiedAt: new Date().toISOString() },
      overrideAccess: true,
    })
    const updated = await finishOwn()
    expect(updated.onboardingCompleted).toBe(true)
  })
})
