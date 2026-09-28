// @vitest-environment node

import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from 'vitest'

import { googlePhotoUrl } from '@/lib/auth/google/avatar'
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
  pictureUrl: null,
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

    it('carries the picture URL, and null when there is none', () => {
      expect(normalizeGoogleProfile({ sub: '1', picture: 'https://lh3.googleusercontent.com/a/x=s96-c' }).pictureUrl).toBe(
        'https://lh3.googleusercontent.com/a/x=s96-c',
      )
      expect(normalizeGoogleProfile({ sub: '1' }).pictureUrl).toBeNull()
    })
  })

  describe('the Google photo URL', () => {
    it('asks Google for a larger square instead of the default 96px', () => {
      expect(googlePhotoUrl('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe(
        'https://lh3.googleusercontent.com/a/abc=s640-c',
      )
      expect(googlePhotoUrl('https://lh3.googleusercontent.com/a/abc')).toBe(
        'https://lh3.googleusercontent.com/a/abc=s640-c',
      )
    })

    it('never fetches from anywhere but googleusercontent.com over https', () => {
      for (const hostile of [
        'http://lh3.googleusercontent.com/a/abc',
        'https://googleusercontent.com.evil.example/a',
        'https://169.254.169.254/latest/meta-data',
        'not a url',
      ]) {
        expect(googlePhotoUrl(hostile)).toBeNull()
      }
    })
  })

  describe('the profile photo', () => {
    const PICTURE = 'https://lh3.googleusercontent.com/a/test-photo=s96-c'

    const stubGooglePhoto = async () => {
      const image = await readFile(path.resolve(process.cwd(), 'src/assets/event-walk.jpg'))
      const fetchMock = vi.fn(async () => new Response(image, { headers: { 'content-type': 'image/jpeg' } }))
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    const profileOf = async (userId: number) =>
      (
        await payload.find({
          collection: 'profiles',
          where: { user: { equals: userId } },
          depth: 0,
          limit: 1,
          overrideAccess: true,
        })
      ).docs[0]

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('becomes the avatar on the first sign-in', async () => {
      const fetchMock = await stubGooglePhoto()
      const profile = googleProfile({ email: `photo-${STAMP}@test.local`, pictureUrl: PICTURE })

      const result = await resolveGoogleUser(payload, profile)
      if (!result.ok) throw new Error(`expected success, got ${result.reason}`)
      createdUserIds.push(result.user.id)

      expect(fetchMock).toHaveBeenCalledWith('https://lh3.googleusercontent.com/a/test-photo=s640-c', expect.anything())
      expect((await profileOf(result.user.id))?.avatar).toBeTruthy()
    })

    it('stays removed once the person removes it', async () => {
      await stubGooglePhoto()
      const profile = googleProfile({ email: `photo-removed-${STAMP}@test.local`, pictureUrl: PICTURE })

      const first = await resolveGoogleUser(payload, profile)
      if (!first.ok) throw new Error('setup failed')
      createdUserIds.push(first.user.id)
      const own = await profileOf(first.user.id)
      await payload.update({ collection: 'profiles', id: own!.id, data: { avatar: null }, overrideAccess: true })

      await resolveGoogleUser(payload, profile)

      expect((await profileOf(first.user.id))?.avatar).toBeFalsy()
    })

    it('never replaces a photo the account already has', async () => {
      await stubGooglePhoto()
      const email = `photo-existing-${STAMP}@test.local`
      const first = await resolveGoogleUser(payload, googleProfile({ email, pictureUrl: PICTURE }))
      if (!first.ok) throw new Error('setup failed')
      createdUserIds.push(first.user.id)
      const before = (await profileOf(first.user.id))?.avatar

      // A second Google identity reaching the same account by address.
      await resolveGoogleUser(payload, googleProfile({ email, pictureUrl: PICTURE }))

      expect((await profileOf(first.user.id))?.avatar).toBe(before)
    })

    it('lets the sign-in through when the photo cannot be downloaded', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
      const profile = googleProfile({ email: `photo-broken-${STAMP}@test.local`, pictureUrl: PICTURE })

      const result = await resolveGoogleUser(payload, profile)
      if (!result.ok) throw new Error(`expected success, got ${result.reason}`)
      createdUserIds.push(result.user.id)

      expect((await profileOf(result.user.id))?.avatar).toBeFalsy()
      expect((await identitiesFor(profile.providerSubject)).docs[0]?.avatarImportedAt).toBeTruthy()
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
