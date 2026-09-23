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
    // The fixture events below are filed under plainUserA, and an event's organizer always holds
    // the role in its obec (Events.requireOrganizerRole). "organizer" still isn't an admin — which
    // is exactly what the delete assertions below are about.
    for (const municipality of [municipalityA, municipalityB]) {
      await payload.create({
        collection: 'user-roles',
        data: { user: plainUserA.id, municipality: municipality.id, role: 'organizer' },
        overrideAccess: true,
      })
    }

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
    await payload.delete({ collection: 'user-roles', where: { user: { equals: plainUserA.id } }, overrideAccess: true }).catch(() => {})
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

  it("a non-admin cannot delete an event, not even the one they organize themselves", async () => {
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

  it('rejects "anyone" as a rulesForCreation value (task 5 — security, mode removed entirely)', async () => {
    await expect(
      payload.create({
        collection: 'municipalities',
        data: {
          name: `Anyone Rule Muni ${STAMP}`,
          // @ts-expect-error — "anyone" was removed from the select's options entirely.
          rulesForCreation: 'anyone',
          lat: 49.5661,
          lng: 15.9403,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })

  it('a municipality admin of A cannot create an event in B (task 5 — no cross-obec creation, whatever B\'s rule)', async () => {
    await expect(
      payload.create({
        collection: 'events',
        data: {
          title: `Cross-obec attempt ${STAMP}`,
          dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          locationText: 'Test location',
          lat: 49.5661,
          lng: 15.9403,
          capacity: 10,
          organizer: adminOfA.id,
          municipality: municipalityB.id,
          categories: [category.id],
          status: 'active',
          isPaid: false,
          registrationApprovalMode: 'manual',
          cancellationPolicy: 'none',
        },
        user: adminOfA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
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

describe('Volunteer pool is per-obec (Profiles volunteer fields)', () => {
  let muniA: { id: number }
  let muniB: { id: number }
  let volunteerA: { id: number; email: string; role: string }
  let adminA: { id: number; email: string; role: string }
  let adminB: { id: number; email: string; role: string }
  let homeless: { id: number; email: string; role: string }
  let volunteerProfile: { id: number }
  let homelessProfile: { id: number }

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muniA = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Volunteer Muni A ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    muniB = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Volunteer Muni B ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })

    const makeUser = (name: string) =>
      payload.create({
        collection: 'users',
        data: { email: `${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
    volunteerA = await makeUser('volunteer-a')
    adminA = await makeUser('vol-admin-a')
    adminB = await makeUser('vol-admin-b')
    homeless = await makeUser('vol-homeless')

    await payload.create({
      collection: 'user-roles',
      data: { user: adminA.id, municipality: muniA.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: adminB.id, municipality: muniB.id, role: 'municipality_admin' },
      overrideAccess: true,
    })

    volunteerProfile = await payload.create({
      collection: 'profiles',
      data: {
        user: volunteerA.id,
        fullName: 'Volunteer A',
        municipality: muniA.id,
        isVolunteer: true,
        volunteerFocus: ['akce'],
        volunteerNote: 'Mám auto',
      },
      overrideAccess: true,
    })
    homelessProfile = await payload.create({
      collection: 'profiles',
      data: { user: homeless.id, fullName: 'Bez obce' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const userIds = [volunteerA.id, adminA.id, adminB.id, homeless.id]
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniB.id, overrideAccess: true }).catch(() => {})
  })

  const readProfileAs = (user: { id: number; email: string; role: string }) =>
    payload.findByID({ collection: 'profiles', id: volunteerProfile.id, user, overrideAccess: false })

  it("an admin of another obec doesn't see that someone is a volunteer", async () => {
    const profile = await readProfileAs(adminB)
    expect(profile.fullName).toBe('Volunteer A')
    expect(profile.isVolunteer).toBeUndefined()
    expect(profile.volunteerFocus).toBeUndefined()
    expect(profile.volunteerNote).toBeUndefined()
  })

  it("an admin of another obec can't list volunteers by filtering on isVolunteer", async () => {
    await expect(
      payload.find({
        collection: 'profiles',
        where: { and: [{ municipality: { equals: muniA.id } }, { isVolunteer: { equals: true } }] },
        user: adminB,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it("the obec's own admin sees the volunteer fields", async () => {
    const profile = await readProfileAs(adminA)
    expect(profile.isVolunteer).toBe(true)
    expect(profile.volunteerFocus).toEqual(['akce'])
  })

  it('the volunteer sees their own volunteer fields', async () => {
    const profile = await readProfileAs(volunteerA)
    expect(profile.isVolunteer).toBe(true)
    expect(profile.volunteerNote).toBe('Mám auto')
  })

  it('someone without an obec cannot join the volunteer pool', async () => {
    await expect(
      payload.update({
        collection: 'profiles',
        id: homelessProfile.id,
        data: { isVolunteer: true },
        user: homeless,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('clearing the obec drops a volunteer out of the pool', async () => {
    const updated = await payload.update({
      collection: 'profiles',
      id: volunteerProfile.id,
      data: { municipality: null },
      user: volunteerA,
      overrideAccess: false,
    })
    expect(updated.isVolunteer).toBe(false)
  })
})

describe('Spolupořadatelé only from the same obec (Events requireCoOrganizerRole)', () => {
  let muniA: { id: number }
  let muniB: { id: number }
  let cat: { id: number }
  let adminA: { id: number; email: string; role: string }
  let pubOrganizerA: { id: number; email: string; role: string }
  let residentA: { id: number; email: string; role: string }
  let organizerB: { id: number; email: string; role: string }
  const eventIds: number[] = []

  const eventData = (coOrganizers: number[]) => ({
    title: `Co-organizer Event ${STAMP}`,
    dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    locationText: 'Test location',
    lat: 49.5661,
    lng: 15.9403,
    capacity: 10,
    organizer: adminA.id,
    coOrganizers,
    categories: [cat.id],
    municipality: muniA.id,
    status: 'active' as const,
    isPaid: false,
    registrationApprovalMode: 'manual' as const,
    cancellationPolicy: 'none' as const,
  })

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muniA = await payload.create({
      collection: 'municipalities',
      data: { name: `Test CoOrg Muni A ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    muniB = await payload.create({
      collection: 'municipalities',
      data: { name: `Test CoOrg Muni B ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category CoOrg ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, municipality: number) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `${name} ${STAMP}`, municipality },
        overrideAccess: true,
      })
      return user
    }
    adminA = await makeUser('coorg-admin-a', muniA.id)
    pubOrganizerA = await makeUser('coorg-hospoda-a', muniA.id)
    residentA = await makeUser('coorg-resident-a', muniA.id)
    // Lives in A, but organizes only in B.
    organizerB = await makeUser('coorg-organizer-b', muniA.id)

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
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniA.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muniB.id, overrideAccess: true }).catch(() => {})
  })

  it("the obec admin can run an event with one of the obec's organizers", async () => {
    const event = await payload.create({
      collection: 'events',
      data: eventData([pubOrganizerA.id]),
      user: adminA,
      overrideAccess: false,
    })
    eventIds.push(event.id)
    expect(event.coOrganizers).toHaveLength(1)
  })

  it('a resident without an organizing role in the obec cannot be a co-organizer', async () => {
    await expect(
      payload.create({ collection: 'events', data: eventData([residentA.id]), user: adminA, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it("another obec's organizer cannot be a co-organizer, even if they live here", async () => {
    await expect(
      payload.create({ collection: 'events', data: eventData([organizerB.id]), user: adminA, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
