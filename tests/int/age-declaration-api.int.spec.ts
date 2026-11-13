// @vitest-environment node
// What a signed-in user can do to their own profile over the API (PATCH /api/profiles/:id) — the
// Local API with `user` and overrideAccess: false runs the same access rules, validation and hooks.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { latestBirthDateInputValue } from '@/lib/date'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role?: string | null; collection: 'users' }
type TestProfile = { id: number }

describe('The 15+ rule holds over the API, not only in the forms', () => {
  let user: TestUser
  let profile: TestProfile
  let admin: TestUser
  let adminsTarget: TestProfile

  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const created = await payload.create({
      collection: 'users',
      data: { email: `age-api-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })
    const ownProfile = await payload.create({
      collection: 'profiles',
      data: { user: created.id, fullName: `Věk API ${name}` },
      overrideAccess: true,
    })
    return { user: { ...created, collection: 'users' as const }, profile: ownProfile }
  }

  const updateOwn = (data: Record<string, unknown>) =>
    payload.update({ collection: 'profiles', id: profile.id, data, user, overrideAccess: false })

  const declare = (type: 'age_15_plus' | 'platform_terms') =>
    payload.create({
      collection: 'consents',
      data: { user: user.id, type, version: '1.0', grantedAt: new Date().toISOString() },
      user,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    ;({ user, profile } = await makeUser('google'))
    ;({ user: admin } = await makeUser('superadmin', 'admin'))
    ;({ profile: adminsTarget } = await makeUser('created-by-admin'))
  })

  afterAll(async () => {
    const users = await payload.find({
      collection: 'users',
      where: { email: { like: `-${STAMP}@test.local` } },
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })
    for (const u of users.docs) {
      await payload.delete({ collection: 'consents', where: { user: { equals: u.id } }, overrideAccess: true })
      await payload.delete({ collection: 'profiles', where: { user: { equals: u.id } }, overrideAccess: true })
      await payload.delete({ collection: 'users', id: u.id, overrideAccess: true })
    }
  })

  describe('date of birth', () => {
    it('refuses one younger than 15 years', async () => {
      await expect(updateOwn({ dateOfBirth: '2016-05-01T00:00:00.000Z' })).rejects.toThrow()
    })

    it('refuses the day after the 15th birthday limit', async () => {
      const [y, m, d] = latestBirthDateInputValue().split('-').map(Number)
      const dayAfter = new Date(Date.UTC(y, m - 1, d + 1)).toISOString()
      await expect(updateOwn({ dateOfBirth: dayAfter })).rejects.toThrow()
    })

    it('accepts exactly 15 years', async () => {
      const limit = `${latestBirthDateInputValue()}T00:00:00.000Z`
      const updated = await updateOwn({ dateOfBirth: limit })
      expect(updated.dateOfBirth?.slice(0, 10)).toBe(latestBirthDateInputValue())
    })

    it('accepts a senior', async () => {
      const updated = await updateOwn({ dateOfBirth: '1948-07-12T00:00:00.000Z' })
      expect(updated.dateOfBirth?.slice(0, 10)).toBe('1948-07-12')
    })

    it('refuses a date in the future', async () => {
      await expect(updateOwn({ dateOfBirth: '2099-01-01T00:00:00.000Z' })).rejects.toThrow()
    })

    it('binds the superadmin too — no account holder is under 15', async () => {
      await expect(
        payload.update({
          collection: 'profiles',
          id: adminsTarget.id,
          data: { dateOfBirth: '2016-05-01T00:00:00.000Z' },
          user: admin,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  describe('finishing onboarding', () => {
    it('is refused without the 15+ declaration', async () => {
      await declare('platform_terms')
      await expect(updateOwn({ onboardingCompleted: true })).rejects.toThrow(/15/)
    })

    it('is refused while the declaration is revoked', async () => {
      const declaration = await declare('age_15_plus')
      await payload.update({
        collection: 'consents',
        id: declaration.id,
        data: { revokedAt: new Date().toISOString() },
        user,
        overrideAccess: false,
      })
      await expect(updateOwn({ onboardingCompleted: true })).rejects.toThrow(/15/)
    })

    it('goes through once declared', async () => {
      await declare('age_15_plus')
      const updated = await updateOwn({ onboardingCompleted: true })
      expect(updated.onboardingCompleted).toBe(true)
    })

    it('is still up to the superadmin for an account they look after', async () => {
      const updated = await payload.update({
        collection: 'profiles',
        id: adminsTarget.id,
        data: { onboardingCompleted: true },
        user: admin,
        overrideAccess: false,
      })
      expect(updated.onboardingCompleted).toBe(true)
    })
  })
})
