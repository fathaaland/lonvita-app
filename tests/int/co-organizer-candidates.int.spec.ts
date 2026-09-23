// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET } from '@/app/api/events/co-organizer-candidates/route'

let payload: Payload

const STAMP = Date.now()

describe('Co-organizer picker search (GET /api/events/co-organizer-candidates)', () => {
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
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniB.id, overrideAccess: true }).catch(() => {})
  })

  const searchAs = async (email: string) => {
    const { token } = await payload.login({ collection: 'users', data: { email, password: 'test1234' } })
    return GET(
      new Request(`http://localhost/api/events/co-organizer-candidates?municipalityId=${muniA.id}&q=picker`, {
        headers: { Authorization: `JWT ${token}` },
      }),
    )
  }

  it("offers only the organizations of the obec's organizers — never the obec itself", async () => {
    const response = await searchAs(adminA.email)
    const body = (await response.json()) as { docs: { owner_id: string; name: string }[] }
    expect(body.docs.map((d) => d.owner_id)).toEqual([String(pubOrganizerA.id)])
    expect(body.docs[0].name).toBe('picker hospoda-a')
  })

  it("doesn't offer the searcher their own organization", async () => {
    const response = await searchAs(pubOrganizerA.email)
    const body = (await response.json()) as { docs: unknown[] }
    expect(body.docs).toEqual([])
  })

  it("can't be used by someone who doesn't organize in the obec", async () => {
    const response = await searchAs(residentA.email)
    expect(response.status).toBe(403)
  })
})
