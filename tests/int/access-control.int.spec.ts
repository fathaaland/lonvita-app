import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// These tests exercise real access-control functions (overrideAccess: false, a real
// `user` passed in) — not the Local API's default overrideAccess: true, which would
// silently skip the exact isolation logic this suite exists to catch regressions in.

let payload: Payload

let municipalityA: { id: number }
let municipalityB: { id: number }
let adminOfA: { id: number; email: string; role: string }
let plainUserA: { id: number; email: string; role: string }
let category: { id: number }
let eventInA: { id: number }
let eventInB: { id: number }

const STAMP = Date.now()

describe('Multi-tenant isolation (brief §A1 — "kde jsou hrany")', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipalityA = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni A ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    municipalityB = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni B ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })

    adminOfA = await payload.create({
      collection: 'users',
      data: { email: `admin-a-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    plainUserA = await payload.create({
      collection: 'users',
      data: { email: `plain-a-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: adminOfA.id, municipality: municipalityA.id, role: 'municipality_admin' },
      overrideAccess: true,
    })

    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Isolation ${STAMP}` },
      overrideAccess: true,
    })

    const baseEventData = {
      title: `Test Event ${STAMP}`,
      dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      locationText: 'Test location',
      lat: 49.5661,
      lng: 15.9403,
      capacity: 10,
      organizer: plainUserA.id,
      categories: [category.id],
      status: 'active' as const,
      isPaid: false,
      registrationApprovalMode: 'manual' as const,
      cancellationPolicy: 'none' as const,
    }
    eventInA = await payload.create({
      collection: 'events',
      data: { ...baseEventData, municipality: municipalityA.id },
      overrideAccess: true,
    })
    eventInB = await payload.create({
      collection: 'events',
      data: { ...baseEventData, municipality: municipalityB.id },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'events', id: eventInA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: eventInB.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { equals: adminOfA.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: adminOfA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: plainUserA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipalityA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipalityB.id, overrideAccess: true }).catch(() => {})
  })

  it("a municipality admin of A cannot delete B's event", async () => {
    await expect(
      payload.delete({
        collection: 'events',
        id: eventInB.id,
        user: adminOfA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('a plain (non-admin) user cannot delete an event, even in their own municipality', async () => {
    await expect(
      payload.delete({
        collection: 'events',
        id: eventInA.id,
        user: plainUserA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it("a municipality admin of A can delete A's own event", async () => {
    const result = await payload.delete({
      collection: 'events',
      id: eventInA.id,
      user: adminOfA,
      overrideAccess: false,
    })
    expect(result.id).toBe(eventInA.id)
  })

  it('an admin of municipality A cannot also become municipality_admin of B', async () => {
    await expect(
      payload.create({
        collection: 'user-roles',
        data: { user: adminOfA.id, municipality: municipalityB.id, role: 'municipality_admin' },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })

  it('municipality A can have a second, different admin', async () => {
    const secondAdminOfA = await payload.create({
      collection: 'users',
      data: { email: `admin-a2-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    const role = await payload.create({
      collection: 'user-roles',
      data: { user: secondAdminOfA.id, municipality: municipalityA.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    expect(role.id).toBeDefined()

    await payload.delete({ collection: 'user-roles', id: role.id, overrideAccess: true })
    await payload.delete({ collection: 'users', id: secondAdminOfA.id, overrideAccess: true })
  })
})

describe('Municipality name uniqueness (task 1 — no re-founding an obec)', () => {
  let muni: { id: number; name: string }

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muni = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Unique Muni ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  it('rejects a second municipality with the same name (different case, padded)', async () => {
    await expect(
      payload.create({
        collection: 'municipalities',
        data: {
          name: `  unique muni ${STAMP}  `,
          rulesForCreation: 'approved_organizers',
          lat: 50.1,
          lng: 16.1,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })

  it('allows updating the same municipality without tripping its own duplicate check', async () => {
    const updated = await payload.update({
      collection: 'municipalities',
      id: muni.id,
      data: { description: 'updated' },
      overrideAccess: true,
    })
    expect(updated.id).toBe(muni.id)
  })

  it('allows a differently-named municipality', async () => {
    const other = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Other Muni ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 50.2,
        lng: 16.2,
      },
      overrideAccess: true,
    })
    expect(other.id).toBeDefined()
    await payload.delete({ collection: 'municipalities', id: other.id, overrideAccess: true })
  })
})

describe('Consents ownership (GDPR foundation, brief §A3)', () => {
  let userOne: { id: number; email: string; role: string }
  let userTwo: { id: number; email: string; role: string }
  let userOneConsent: { id: number }

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    userOne = await payload.create({
      collection: 'users',
      data: { email: `consent-one-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    userTwo = await payload.create({
      collection: 'users',
      data: { email: `consent-two-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    userOneConsent = await payload.create({
      collection: 'consents',
      data: { user: userOne.id, type: 'platform_terms', version: '1.0', grantedAt: new Date().toISOString() },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'consents', where: { user: { equals: userOne.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: userOne.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: userTwo.id, overrideAccess: true }).catch(() => {})
  })

  it("a user cannot read another user's consent rows", async () => {
    const result = await payload.find({
      collection: 'consents',
      where: { id: { equals: userOneConsent.id } },
      user: userTwo,
      overrideAccess: false,
    })
    expect(result.docs).toHaveLength(0)
  })

  it('a user can read their own consent rows', async () => {
    const result = await payload.find({
      collection: 'consents',
      where: { id: { equals: userOneConsent.id } },
      user: userOne,
      overrideAccess: false,
    })
    expect(result.docs).toHaveLength(1)
  })

  it("a user cannot create a consent row attributed to someone else's account", async () => {
    await expect(
      payload.create({
        collection: 'consents',
        data: { user: userOne.id, type: 'marketing', version: '1.0', grantedAt: new Date().toISOString() },
        user: userTwo,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})
