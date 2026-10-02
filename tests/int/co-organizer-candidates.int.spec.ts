// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET } from '@/app/api/events/co-organizer-candidates/route'

let payload: Payload

const STAMP = Date.now()

describe('Co-organizer picker list (GET /api/events/co-organizer-candidates)', () => {
  let muniA: { id: number }
  let muniB: { id: number }
  let adminA: { id: number; email: string }
  let pubOrganizerA: { id: number; email: string }
  let residentA: { id: number; email: string }
  let organizerB: { id: number; email: string }

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muniA = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Picker Muni A ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    muniB = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Picker Muni B ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })

    const makeUser = async (name: string) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      // Everyone lives in A — the search must go by role in the obec, not by home municipality.
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `picker ${name}`, municipality: muniA.id },
        overrideAccess: true,
      })
      return user
    }
    adminA = await makeUser('admin-a')
    pubOrganizerA = await makeUser('hospoda-a')
    residentA = await makeUser('resident-a')
    organizerB = await makeUser('organizer-b')

    for (const [user, municipality, role] of [
      [adminA, muniA, 'municipality_admin'],
      [pubOrganizerA, muniA, 'organizer'],
      [organizerB, muniB, 'organizer'],
    ] as const) {
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: municipality.id, role },
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    const userIds = [adminA.id, pubOrganizerA.id, residentA.id, organizerB.id]
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniB.id, overrideAccess: true }).catch(() => {})
  })

  const searchAs = async (email: string) => {
    const { token } = await payload.login({ collection: 'users', data: { email, password: 'test1234' } })
    return GET(
      new Request(`http://localhost/api/events/co-organizer-candidates?municipalityId=${muniA.id}`, {
        headers: { Authorization: `JWT ${token}` },
      }),
    )
  }

  it("offers the obec's admin the obec first, then the organizations of its organizers", async () => {
    const response = await searchAs(adminA.email)
    const body = (await response.json()) as {
      docs: { owner_id: string | null; name: string; type: string; avatar_url: string | null }[]
    }
    expect(body.docs.map((d) => [d.name, d.owner_id, d.type])).toEqual([
      [`Test Picker Muni A ${STAMP}`, null, 'municipality'],
      ['picker hospoda-a', String(pubOrganizerA.id), 'individual'],
    ])
    // No photo set — the picker falls back to the organization's initials.
    expect(body.docs.map((d) => d.avatar_url)).toEqual([null, null])
  })

  it("shows the organization's own photo, set by its owner — not the owner's profile photo", async () => {
    const organization = (
      await payload.find({
        collection: 'organizations',
        where: { owner: { equals: pubOrganizerA.id } },
        depth: 0,
        overrideAccess: true,
      })
    ).docs[0]
    // A 1×1 PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    const media = await payload.create({
      collection: 'media',
      data: { alt: 'Logo hospody' },
      file: { data: png, mimetype: 'image/png', name: `picker-logo-${STAMP}.png`, size: png.length },
      overrideAccess: true,
    })

    // The URL is derived from the photo — a client can't point it anywhere else.
    const updated = await payload.update({
      collection: 'organizations',
      id: organization.id,
      data: { avatar: media.id, avatarUrl: 'https://example.com/evil.png' } as never,
      user: pubOrganizerA,
      overrideAccess: false,
    })
    expect(updated.avatarUrl).toBeTruthy()
    expect(updated.avatarUrl).not.toContain('example.com')

    const response = await searchAs(adminA.email)
    const body = (await response.json()) as { docs: { owner_id: string | null; avatar_url: string | null }[] }
    expect(body.docs.find((d) => d.owner_id === String(pubOrganizerA.id))?.avatar_url).toBe(updated.avatarUrl)

    const cleared = await payload.update({
      collection: 'organizations',
      id: organization.id,
      data: { avatar: null },
      user: pubOrganizerA,
      overrideAccess: false,
    })
    expect(cleared.avatarUrl).toBeNull()
    await payload.delete({ collection: 'media', id: media.id, overrideAccess: true }).catch(() => {})
  })

  it("offers an organizer the obec to invite, but never their own organization", async () => {
    const response = await searchAs(pubOrganizerA.email)
    const body = (await response.json()) as { docs: { owner_id: string | null; name: string; type: string }[] }
    expect(body.docs.map((d) => [d.name, d.owner_id, d.type])).toEqual([
      [`Test Picker Muni A ${STAMP}`, null, 'municipality'],
    ])
  })

  it("can't be used by someone who doesn't organize in the obec", async () => {
    const response = await searchAs(residentA.email)
    expect(response.status).toBe(403)
  })
})
