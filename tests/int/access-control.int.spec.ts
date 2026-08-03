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
let requestForA: { id: number }
let requestForB: { id: number }

const STAMP = Date.now()

describe('Multi-tenant isolation (brief §A1 — "kde jsou hrany")', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipalityA = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni A ${STAMP}`, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })
    municipalityB = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni B ${STAMP}`, rulesForCreation: 'approved_organizers' },
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
      data: { user: adminOfA.id, municipality: municipalityA.id, role: 'admin' },
      overrideAccess: true,
    })

    requestForA = await payload.create({
      collection: 'organizer-requests',
      data: { user: plainUserA.id, municipality: municipalityA.id, description: 'wants to organize in A', status: 'pending' },
      overrideAccess: true,
    })
    requestForB = await payload.create({
      collection: 'organizer-requests',
      data: { user: plainUserA.id, municipality: municipalityB.id, description: 'wants to organize in B', status: 'pending' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'organizer-requests', id: requestForA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizer-requests', id: requestForB.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { equals: adminOfA.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: adminOfA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: plainUserA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipalityA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipalityB.id, overrideAccess: true }).catch(() => {})
  })

  it("a municipality admin of A sees A's organizer requests", async () => {
    const result = await payload.find({
      collection: 'organizer-requests',
      where: { municipality: { equals: municipalityA.id } },
      user: adminOfA,
      overrideAccess: false,
    })
    expect(result.docs.map((d) => d.id)).toContain(requestForA.id)
  })

  it("a municipality admin of A cannot see B's organizer requests", async () => {
    const result = await payload.find({
      collection: 'organizer-requests',
      where: { municipality: { equals: municipalityB.id } },
      user: adminOfA,
      overrideAccess: false,
    })
    expect(result.docs.map((d) => d.id)).not.toContain(requestForB.id)
  })

  it("a municipality admin of A cannot approve/reject B's organizer request directly by ID", async () => {
    await expect(
      payload.update({
        collection: 'organizer-requests',
        id: requestForB.id,
        data: { status: 'approved' },
        user: adminOfA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('a plain (non-admin) user cannot approve their own organizer request', async () => {
    await expect(
      payload.update({
        collection: 'organizer-requests',
        id: requestForA.id,
        data: { status: 'approved' },
        user: plainUserA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
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
