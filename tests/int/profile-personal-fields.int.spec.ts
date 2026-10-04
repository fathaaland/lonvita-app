// @vitest-environment node
import { getPayload, Payload, type Where } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

type TestUser = { id: number; email: string; role: string; collection: 'users' }

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

let municipality: { id: number }
let otherMunicipality: { id: number }
let category: { id: number }
let resident: TestUser
let neighbour: TestUser
let organizer: TestUser
let obecAdmin: TestUser
let otherObecAdmin: TestUser
let platformAdmin: TestUser
let eventId: number

const PERSONAL = { phone: '+420 601 234 567', dateOfBirth: '1955-06-01T00:00:00.000Z', gender: 'zena' as const }

const createUser = async (name: string, home: { id: number }, role = 'user'): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `personal-${name}-${STAMP}@test.local`, password: 'test1234', role: role as 'user' },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Personal ${name}`, municipality: home.id, notifyEmail: false, ...PERSONAL },
    overrideAccess: true,
  })
  return { ...user, collection: 'users' } as TestUser
}

/** `viewer`'s view of `owner`'s profile — what a REST read returns them. */
const profileAs = async (owner: TestUser, viewer: TestUser) =>
  (
    await payload.find({
      collection: 'profiles',
      where: { user: { equals: owner.id } },
      depth: 0,
      limit: 1,
      user: viewer,
      overrideAccess: false,
    })
  ).docs[0]!

describe('A profile’s personal details stay with its owner', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Personal Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    otherMunicipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Personal Other ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Personal Category ${STAMP}` },
      overrideAccess: true,
    })
    resident = await createUser('resident', municipality)
    neighbour = await createUser('neighbour', municipality)
    organizer = await createUser('organizer', municipality)
    obecAdmin = await createUser('obecadmin', municipality)
    otherObecAdmin = await createUser('otheradmin', otherMunicipality)
    platformAdmin = await createUser('platform', municipality, 'admin')

    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: obecAdmin.id, municipality: municipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: otherObecAdmin.id, municipality: otherMunicipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'profiles',
      where: { user: { equals: resident.id } },
      data: { interests: [category.id] },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const userIds = [resident, neighbour, organizer, obecAdmin, otherObecAdmin, platformAdmin].map((u) => u.id)
    if (eventId) {
      await payload.delete({ collection: 'registrations', where: { event: { equals: eventId } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'events', id: eventId, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { municipality: { in: [municipality.id, otherMunicipality.id] } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    for (const m of [municipality, otherMunicipality]) {
      await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
    }
  })

  it('the owner and a platform admin see everything', async () => {
    for (const viewer of [resident, platformAdmin]) {
      const profile = await profileAs(resident, viewer)
      expect(profile.phone).toBe(PERSONAL.phone)
      expect(profile.dateOfBirth).toBeTruthy()
      expect(profile.gender).toBe('zena')
      expect(profile.interests?.length).toBe(1)
    }
  })

  it('anyone else signed in sees the name, not the personal details', async () => {
    const profile = await profileAs(resident, neighbour)
    expect(profile.fullName).toBe('Personal resident')
    expect(profile.phone).toBeUndefined()
    expect(profile.dateOfBirth).toBeUndefined()
    expect(profile.gender).toBeUndefined()
    expect(profile.interests).toBeUndefined()
  })

  it('nobody but a platform admin filters profiles by them', async () => {
    const filters: Where[] = [{ phone: { equals: PERSONAL.phone } }, { dateOfBirth: { exists: true } }]
    for (const where of filters) {
      await expect(
        payload.find({ collection: 'profiles', where, user: obecAdmin, overrideAccess: false }),
      ).rejects.toThrow(/cannot be queried/)
    }
  })

  it('the home obec’s admin sees the date of birth (its 50+ analytics) — nothing else, and no other obec’s admin', async () => {
    const own = await profileAs(resident, obecAdmin)
    expect(own.dateOfBirth).toBeTruthy()
    expect(own.gender).toBeUndefined()
    expect(own.phone).toBeUndefined()

    expect((await profileAs(resident, otherObecAdmin)).dateOfBirth).toBeUndefined()
  })

  it('whoever runs an event the person signed up for sees their phone', async () => {
    expect((await profileAs(resident, organizer)).phone).toBeUndefined()

    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Personal event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventId = event.id
    await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: resident.id } as never,
      context: { skipNotifications: true },
      overrideAccess: true,
    })

    const seen = await profileAs(resident, organizer)
    expect(seen.phone).toBe(PERSONAL.phone)
    expect(seen.dateOfBirth).toBeUndefined()
    // The obec's admin manages every event in the obec — the phone with it.
    expect((await profileAs(resident, obecAdmin)).phone).toBe(PERSONAL.phone)
    // Not someone who merely signed up for the same event.
    expect((await profileAs(neighbour, organizer)).phone).toBeUndefined()
  })

  it('the owner changes them after onboarding', async () => {
    const profile = await profileAs(resident, resident)
    const updated = await payload.update({
      collection: 'profiles',
      id: profile.id,
      data: { phone: '+420 777 000 111', gender: 'neuvedeno', interests: [] },
      user: resident,
      overrideAccess: false,
    })
    expect(updated.phone).toBe('+420 777 000 111')
    expect(updated.gender).toBe('neuvedeno')
    await expect(
      payload.update({ collection: 'profiles', id: profile.id, data: { phone: '+420 600 000 000' }, user: neighbour, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
