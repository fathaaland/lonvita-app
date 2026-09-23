// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: 'admin' | 'user' }

const relId = (value: number | { id: number }) => (typeof value === 'object' ? value.id : value)

describe('Superadmin manages organizations', () => {
  let muni: { id: number }
  let otherMuni: { id: number }
  let cat: { id: number }
  let superadmin: TestUser
  let obecAdmin: TestUser
  let cafeOwner: TestUser
  let clubOwner: TestUser
  let newcomer: TestUser
  const eventIds: number[] = []

  const organizerRoles = (user: TestUser, municipality = muni) =>
    payload.find({
      collection: 'user-roles',
      where: {
        and: [{ user: { equals: user.id } }, { municipality: { equals: municipality.id } }, { role: { equals: 'organizer' } }],
      },
      depth: 0,
      overrideAccess: true,
    })

  const organizationOf = async (user: TestUser) => {
    const found = await payload.find({
      collection: 'organizations',
      where: { and: [{ owner: { equals: user.id } }, { municipality: { equals: muni.id } }] },
      depth: 0,
      overrideAccess: true,
    })
    return found.docs[0]
  }

  const createAsSuperadmin = (data: { name: string; type: 'business' | 'association' | 'individual'; owner: number; municipality: number }) =>
    payload.create({ collection: 'organizations', data, user: superadmin, overrideAccess: false })

  const createEvent = async (organizer: TestUser, coOrganizations: number[], daysFromNow = 7) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Org CRUD Event ${STAMP}`,
        dateTime: new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        coOrganizations,
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        cancellationPolicy: 'none',
      },
      overrideAccess: true,
    })
    eventIds.push(event.id)
    return event
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Org CRUD Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    otherMuni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Org CRUD Other ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Org CRUD ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, role: 'admin' | 'user' = 'user') => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `orgcrud-${name}-${STAMP}@test.local`, password: 'test1234', role },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `orgcrud ${name}`, municipality: muni.id, notifyEmail: false },
        overrideAccess: true,
      })
      return user as TestUser
    }
    superadmin = await makeUser('superadmin', 'admin')
    obecAdmin = await makeUser('obec-admin')
    cafeOwner = await makeUser('kavarna')
    clubOwner = await makeUser('spolek')
    newcomer = await makeUser('newcomer')

    await payload.create({
      collection: 'user-roles',
      data: { user: obecAdmin.id, municipality: muni.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    for (const user of [cafeOwner, clubOwner]) {
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: muni.id, role: 'organizer' },
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    const userIds = [superadmin.id, obecAdmin.id, cafeOwner.id, clubOwner.id, newcomer.id]
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: otherMuni.id, overrideAccess: true }).catch(() => {})
  })

  it('creating an organization makes its owner an organizer in the obec', async () => {
    const created = await createAsSuperadmin({ name: '  Pekárna U Mostu ', type: 'business', owner: newcomer.id, municipality: muni.id })
    expect(created.name).toBe('Pekárna U Mostu')

    const roles = await organizerRoles(newcomer)
    expect(roles.docs).toHaveLength(1)
    // The role's own hook found this organization instead of making a second one.
    const all = await payload.find({
      collection: 'organizations',
      where: { owner: { equals: newcomer.id } },
      depth: 0,
      overrideAccess: true,
    })
    expect(all.docs.map((o) => o.name)).toEqual(['Pekárna U Mostu'])
  })

  it('rejects a second organization for the same owner in the same obec', async () => {
    await expect(
      createAsSuperadmin({ name: 'Druhá kavárna', type: 'business', owner: cafeOwner.id, municipality: muni.id }),
    ).rejects.toThrow(/už v obci organizaci má/)
  })

  it("rejects an organization for the obec's own admin", async () => {
    await expect(
      createAsSuperadmin({ name: 'Obecní spolek', type: 'association', owner: obecAdmin.id, municipality: muni.id }),
    ).rejects.toThrow(/Admin obce/)
    expect((await organizerRoles(obecAdmin)).docs).toHaveLength(0)
  })

  it("isn't open to anyone but the superadmin", async () => {
    await expect(
      payload.create({
        collection: 'organizations',
        data: { name: 'Vlastní', type: 'individual', owner: clubOwner.id, municipality: otherMuni.id },
        user: obecAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('edits name and type, but owner and obec stay put', async () => {
    const cafe = await organizationOf(cafeOwner)
    const updated = await payload.update({
      collection: 'organizations',
      id: cafe.id,
      data: { name: 'Kavárna NMNM', type: 'business', owner: clubOwner.id, municipality: otherMuni.id },
      user: superadmin,
      overrideAccess: false,
    })
    expect(updated.name).toBe('Kavárna NMNM')
    expect(updated.type).toBe('business')
    expect(relId(updated.owner)).toBe(cafeOwner.id)
    expect(relId(updated.municipality)).toBe(muni.id)
  })

  it('deleting an organization takes it off co-organized events and ends its owner as organizer', async () => {
    const cafe = await organizationOf(cafeOwner)
    const club = await organizationOf(clubOwner)
    // A past event too — the cleanup mustn't trip over the edit validation of finished events.
    const upcoming = await createEvent(obecAdmin, [cafe.id, club.id])
    const past = await createEvent(obecAdmin, [cafe.id], 7)
    await payload.db.updateOne({
      collection: 'events',
      id: past.id,
      data: { dateTime: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
    })

    await payload.delete({ collection: 'organizations', id: cafe.id, user: superadmin, overrideAccess: false })

    const after = await payload.findByID({ collection: 'events', id: upcoming.id, depth: 0, overrideAccess: true })
    expect((after.coOrganizations ?? []).map(relId)).toEqual([club.id])
    expect((after.coOrganizers ?? []).map(relId)).toEqual([clubOwner.id])
    expect((after.categories ?? []).map(relId)).toEqual([cat.id])

    const pastAfter = await payload.findByID({ collection: 'events', id: past.id, depth: 0, overrideAccess: true })
    expect(pastAfter.coOrganizations ?? []).toEqual([])
    expect(pastAfter.coOrganizers ?? []).toEqual([])

    expect((await organizerRoles(cafeOwner)).docs).toHaveLength(0)
    expect(await organizationOf(cafeOwner)).toBeUndefined()
  })

  it("won't delete an organization that still runs events", async () => {
    const club = await organizationOf(clubOwner)
    const own = await createEvent(clubOwner, [])
    expect(relId(own.organization!)).toBe(club.id)

    await expect(
      payload.delete({ collection: 'organizations', id: club.id, user: superadmin, overrideAccess: false }),
    ).rejects.toThrow(/pořádá 1 akcí/)
    expect(await organizationOf(clubOwner)).toBeDefined()
    expect((await organizerRoles(clubOwner)).docs).toHaveLength(1)
  })

  const obecOrganizationOf = async (municipality: { id: number }) => {
    const found = await payload.find({
      collection: 'organizations',
      where: { and: [{ municipality: { equals: municipality.id } }, { type: { equals: 'municipality' } }] },
      depth: 0,
      overrideAccess: true,
    })
    return found.docs
  }

  it("every obec has its own organization, with no owner, that follows the obec's name", async () => {
    const [obec] = await obecOrganizationOf(muni)
    expect(obec.name).toBe(`Test Org CRUD Muni ${STAMP}`)
    expect(obec.owner ?? null).toBeNull()

    await payload.update({
      collection: 'municipalities',
      id: otherMuni.id,
      data: { name: `Test Org CRUD Renamed ${STAMP}` },
      overrideAccess: true,
    })
    const renamed = await obecOrganizationOf(otherMuni)
    expect(renamed.map((o) => o.name)).toEqual([`Test Org CRUD Renamed ${STAMP}`])
  })

  it("the obec's organization can be renamed, but not retyped, deleted or created by hand", async () => {
    const [obec] = await obecOrganizationOf(muni)

    const renamed = await payload.update({
      collection: 'organizations',
      id: obec.id,
      data: { name: 'Obec Testov' },
      user: superadmin,
      overrideAccess: false,
    })
    expect(renamed.name).toBe('Obec Testov')

    await expect(
      payload.update({ collection: 'organizations', id: obec.id, data: { type: 'business' }, user: superadmin, overrideAccess: false }),
    ).rejects.toThrow()
    const cafe = await organizationOf(clubOwner)
    await expect(
      payload.update({ collection: 'organizations', id: cafe.id, data: { type: 'municipality' }, user: superadmin, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.delete({ collection: 'organizations', id: obec.id, user: superadmin, overrideAccess: false }),
    ).rejects.toThrow(/patří k obci/)
    await expect(
      payload.update({
        collection: 'organizations',
        id: obec.id,
        data: { deletedAt: new Date().toISOString() },
        user: superadmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'organizations',
        data: { name: 'Druhá obec', type: 'municipality', municipality: muni.id } as never,
        user: superadmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    expect(await obecOrganizationOf(muni)).toHaveLength(1)
  })

  it("an obec admin's events are run as the obec", async () => {
    const [obec] = await obecOrganizationOf(muni)
    const event = await createEvent(obecAdmin, [])
    expect(relId(event.organization!)).toBe(obec.id)
  })

  it("deleting the obec takes its organization along", async () => {
    const doomed = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Org CRUD Doomed ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    const [obec] = await obecOrganizationOf(doomed)
    expect(obec).toBeDefined()

    await payload.delete({ collection: 'municipalities', id: doomed.id, overrideAccess: true })
    const gone = await payload.findByID({ collection: 'organizations', id: obec.id, overrideAccess: true }).catch(() => null)
    expect(gone).toBeNull()
  })
})
