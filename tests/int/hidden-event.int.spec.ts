import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// "Pozastavit zobrazení akce" (isHidden) — not just off the feed: the event is gone for everyone it
// doesn't concern, link or no link, and takes no new sign-ups.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe('A hidden event', () => {
  let muni: { id: number }
  let otherMuni: { id: number }
  let category: { id: number }
  let organizer: TestUser
  let coOrganizer: TestUser
  let obecAdmin: TestUser
  let otherAdmin: TestUser
  let registrant: TestUser
  let stranger: TestUser
  let eventId: number
  const users: TestUser[] = []

  const makeUser = async (name: string) => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `hidden-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as TestUser
    users.push(user)
    return user
  }

  const sees = async (viewer: TestUser | null) => {
    const found = await payload.find({
      collection: 'events',
      where: { id: { equals: eventId } },
      depth: 0,
      ...(viewer ? { user: viewer } : {}),
      overrideAccess: false,
    })
    return found.totalDocs === 1
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const makeMuni = (name: string) =>
      payload.create({
        collection: 'municipalities',
        data: { name: `Hidden ${name} ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
        overrideAccess: true,
      })
    muni = await makeMuni('A')
    otherMuni = await makeMuni('B')
    category = await payload.create({ collection: 'event-categories', data: { name: `Hidden ${STAMP}` }, overrideAccess: true })
    organizer = await makeUser('organizer')
    coOrganizer = await makeUser('co-organizer')
    obecAdmin = await makeUser('obec-admin')
    otherAdmin = await makeUser('other-admin')
    registrant = await makeUser('registrant')
    stranger = await makeUser('stranger')
    await payload.create({ collection: 'user-roles', data: { user: obecAdmin.id, municipality: muni.id, role: 'municipality_admin' }, overrideAccess: true })
    await payload.create({ collection: 'user-roles', data: { user: otherAdmin.id, municipality: otherMuni.id, role: 'municipality_admin' }, overrideAccess: true })

    const event = await payload.db.create({
      collection: 'events',
      data: {
        title: `Hidden ${STAMP}`,
        dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        coOrganizers: [coOrganizer.id],
        municipality: muni.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        isHidden: true,
        registrationApprovalMode: 'auto',
      },
    })
    eventId = event.id
    await payload.db.create({
      collection: 'registrations',
      data: { event: eventId, user: registrant.id, status: 'approved', role: 'participant' },
    })
  })

  afterAll(async () => {
    const userIds = users.map((u) => u.id)
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { equals: eventId } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: eventId, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    for (const m of [muni, otherMuni]) await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
  })

  it("is out of reach for a guest, a stranger and another obec's admin — even by its id", async () => {
    expect(await sees(null)).toBe(false)
    expect(await sees(stranger)).toBe(false)
    expect(await sees(otherAdmin)).toBe(false)
    await expect(
      payload.findByID({ collection: 'events', id: eventId, user: stranger, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('stays with its team, its obec and whoever is already signed up', async () => {
    for (const viewer of [organizer, coOrganizer, obecAdmin, registrant]) expect(await sees(viewer)).toBe(true)
  })

  it('takes no new sign-ups', async () => {
    await expect(
      payload.create({
        collection: 'registrations',
        data: { event: eventId, user: stranger.id, status: 'pending' },
        user: stranger,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/pozastavená/) })
  })

  it('is everyone’s again once published', async () => {
    await payload.update({ collection: 'events', id: eventId, data: { isHidden: false }, overrideAccess: true, context: { skipNotifications: true } })
    expect(await sees(null)).toBe(true)
    expect(await sees(stranger)).toBe(true)
  })
})
