// @vitest-environment node

import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { resolveGoogleUser } from '@/lib/auth/google/link-account'
import { normalizeGoogleProfile } from '@/lib/auth/google/provider'
import { createOAuthState, verifyOAuthState } from '@/lib/auth/google/state'

import type { GoogleProfile } from '@/lib/auth/google/provider'

let payload: Payload
const STAMP = Date.now()
const createdUserIds: number[] = []

const googleProfile = (overrides: Partial<GoogleProfile> = {}): GoogleProfile => ({
  providerSubject: `sub-${STAMP}-${Math.random().toString(36).slice(2)}`,
  email: `google-${STAMP}@test.local`,
  emailVerified: true,
  fullName: 'Google Uživatel',
  ...overrides,
})

const identitiesFor = async (subject: string) =>
  payload.find({
    collection: 'auth-identities',
    where: { providerSubject: { equals: subject } },
    depth: 0,
    overrideAccess: true,
  })

describe('Signing in with Google', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of createdUserIds) {
      await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    }
  })

  describe('the CSRF state', () => {
    it('accepts the nonce it issued, and carries returnTo with it', () => {
      const { state, cookieValue } = createOAuthState('/moje-akce')

      expect(verifyOAuthState(state, cookieValue)).toEqual({ valid: true, returnTo: '/moje-akce' })
    })

    it('refuses a nonce that does not match the cookie', () => {
      const { cookieValue } = createOAuthState('/')
      const other = createOAuthState('/')

      expect(verifyOAuthState(other.state, cookieValue).valid).toBe(false)
    })

    it('refuses a callback with no cookie at all', () => {
      const { state } = createOAuthState('/')

      expect(verifyOAuthState(state, undefined).valid).toBe(false)
      expect(verifyOAuthState(state, '').valid).toBe(false)
    })

    it('never carries an off-site returnTo through the flow', () => {
      for (const hostile of ['https://evil.example/steal', '//evil.example', 'javascript:alert(1)']) {
        const { state, cookieValue } = createOAuthState(hostile)
        const result = verifyOAuthState(state, cookieValue)

        expect(result).toEqual({ valid: true, returnTo: '/' })
      }
    })
  })

  describe('the profile Google sends back', () => {
    it('only counts a real boolean true as verified', () => {
      expect(normalizeGoogleProfile({ sub: '1', email: 'a@b.cz', email_verified: true }).emailVerified).toBe(true)
      expect(normalizeGoogleProfile({ sub: '1', email: 'a@b.cz', email_verified: 'true' }).emailVerified).toBe(false)
      expect(normalizeGoogleProfile({ sub: '1', email: 'a@b.cz' }).emailVerified).toBe(false)
    })

    it('builds a name out of given/family when there is no full name', () => {
      expect(normalizeGoogleProfile({ sub: '1', given_name: 'Jana', family_name: 'Nováková' }).fullName).toBe(
        'Jana Nováková',
      )
    })
  })

  describe('resolving the account', () => {
    it('creates an account, a profile and an identity for a first-time sign-in', async () => {
      const profile = googleProfile({ email: `first-${STAMP}@test.local` })

      const result = await resolveGoogleUser(payload, profile)
      if (!result.ok) throw new Error(`expected success, got ${result.reason}`)
      createdUserIds.push(result.user.id)

      expect(result.linked).toBe(false)
      expect(result.user.email).toBe(profile.email)

      const profiles = await payload.find({
        collection: 'profiles',
        where: { user: { equals: result.user.id } },
        overrideAccess: true,
      })
      expect(profiles.docs[0]?.fullName).toBe('Google Uživatel')
      expect(profiles.docs[0]?.onboardingCompleted).toBeFalsy()
      expect((await identitiesFor(profile.providerSubject)).totalDocs).toBe(1)
    })

    it('logs the same person back in without a second identity', async () => {
      const profile = googleProfile({ email: `repeat-${STAMP}@test.local` })

      const first = await resolveGoogleUser(payload, profile)
      if (!first.ok) throw new Error('setup failed')
      createdUserIds.push(first.user.id)

      const second = await resolveGoogleUser(payload, profile)
      if (!second.ok) throw new Error(`expected success, got ${second.reason}`)

      expect(second.user.id).toBe(first.user.id)
      expect((await identitiesFor(profile.providerSubject)).totalDocs).toBe(1)
    })

    it('links a verified address to the account that already owns it', async () => {
      const email = `existing-${STAMP}@test.local`
      const existing = await payload.create({
        collection: 'users',
        data: { email, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      createdUserIds.push(existing.id)

      const result = await resolveGoogleUser(payload, googleProfile({ email }))
      if (!result.ok) throw new Error(`expected success, got ${result.reason}`)

      expect(result.user.id).toBe(existing.id)
      expect(result.linked).toBe(true)
    })

    it('refuses to reach an existing account on an unverified address', async () => {
      const email = `victim-${STAMP}@test.local`
      const victim = await payload.create({
        collection: 'users',
        data: { email, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      createdUserIds.push(victim.id)

      const result = await resolveGoogleUser(payload, googleProfile({ email, emailVerified: false }))

      expect(result).toEqual({ ok: false, reason: 'email-unverified' })
      expect((await identitiesFor(googleProfile().providerSubject)).totalDocs).toBe(0)
    })

    it('refuses a profile with no address at all', async () => {
      const result = await resolveGoogleUser(payload, googleProfile({ email: null }))

      expect(result).toEqual({ ok: false, reason: 'no-email' })
    })
  })
})
