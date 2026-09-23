// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET, POST } from '@/app/api/auth/onboarding-municipality/route'

let payload: Payload

const STAMP = Date.now()

describe('Obec step in onboarding for Google sign-ups (/api/auth/onboarding-municipality)', () => {
  let muni: { id: number }
  let googleUser: { id: number; email: string }
  let emailUser: { id: number; email: string }

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Onboarding Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })

    const makeUser = async (name: string) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: name },
        overrideAccess: true,
      })
      return user
    }
    googleUser = await makeUser('onboarding-google')
    // Signed up with e-mail and chose "bez obce" on the registration map.
    emailUser = await makeUser('onboarding-email')

    await payload.create({
      collection: 'auth-identities',
      data: {
        user: googleUser.id,
        provider: 'google',
        providerSubject: `google-sub-${STAMP}`,
        providerType: 'social',
        email: googleUser.email,
        emailVerified: true,
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const userIds = [googleUser.id, emailUser.id]
    await payload.delete({ collection: 'auth-identities', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  const authHeaders = async (email: string) => {
    const { token } = await payload.login({ collection: 'users', data: { email, password: 'test1234' } })
    return { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' }
  }
  const url = 'http://localhost/api/auth/onboarding-municipality'
  const isNeeded = async (email: string) =>
    ((await (await GET(new Request(url, { headers: await authHeaders(email) }))).json()) as { needed: boolean }).needed
  const pick = async (email: string, municipality: number) =>
    POST(new Request(url, { method: 'POST', headers: await authHeaders(email), body: JSON.stringify({ municipality }) }))

  it('asks a Google sign-up without an obec to pick one', async () => {
    expect(await isNeeded(googleUser.email)).toBe(true)
  })

  it("doesn't ask an e-mail sign-up, who already chose on the registration map", async () => {
    expect(await isNeeded(emailUser.email)).toBe(false)
    expect((await pick(emailUser.email, muni.id)).status).toBe(409)
  })

  it('files the Google sign-up under the picked obec with a participant role', async () => {
    expect((await pick(googleUser.email, muni.id)).status).toBe(200)
    // A retry with the same obec (onboarding failed to finish) still succeeds.
    expect((await pick(googleUser.email, muni.id)).status).toBe(200)

    const profile = (
      await payload.find({ collection: 'profiles', where: { user: { equals: googleUser.id } }, depth: 0, overrideAccess: true })
    ).docs[0]
    expect(profile.municipality).toBe(muni.id)

    const roles = await payload.find({
      collection: 'user-roles',
      where: { user: { equals: googleUser.id } },
      depth: 0,
      overrideAccess: true,
    })
    expect(roles.docs.map((r) => r.role)).toEqual(['participant'])
    expect(await isNeeded(googleUser.email)).toBe(false)
  })
})
