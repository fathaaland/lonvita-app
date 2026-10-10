import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

describe('An event holds no more participants than its capacity', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: TestUser
  const people: TestUser[] = []
  const eventIds: number[] = []

  const createEvent = async (registrationApprovalMode: 'auto' | 'manual') => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Capacity ${registrationApprovalMode} ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Sál',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 1,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode,
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventIds.push(event.id)
    return event
  }

  const signUp = (eventId: number, user: TestUser) =>
    payload.create({
      collection: 'registrations',
      data: { event: eventId, user: user.id, status: 'pending' },
      user,
      overrideAccess: false,
    })

  const approve = (registrationId: number) =>
    payload.update({
      collection: 'registrations',
      id: registrationId,
      data: { status: 'approved' },
      user: organizer,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Capacity Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `Capacity Cat ${STAMP}` }, overrideAccess: true })
    const makeUser = (name: string) =>
      payload.create({
        collection: 'users',
        data: { email: `capacity-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      }) as Promise<TestUser>
    organizer = await makeUser('organizer')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    people.push(await makeUser('first'), await makeUser('second'))
  })

  afterAll(async () => {
    const userIds = [organizer.id, ...people.map((p) => p.id)]
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('a full event without approval says so plainly — a 400 the page can show, not a 500', async () => {
    const event = await createEvent('auto')
    expect((await signUp(event.id, people[0])).status).toBe('approved')
    await expect(signUp(event.id, people[1])).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/plná/) })
  })

  it('the organizer cannot approve past the capacity of an event with approval', async () => {
    const event = await createEvent('manual')
    const first = await signUp(event.id, people[0])
    const second = await signUp(event.id, people[1])
    expect((await approve(first.id)).status).toBe('approved')
    await expect(approve(second.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/plná/) })
  })

  it('turns "full" by itself once the last place goes, and "active" again when one frees up', async () => {
    const event = await createEvent('auto')
    const statusOf = async () =>
      (await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })).status

    const registration = await signUp(event.id, people[0])
    expect(await statusOf()).toBe('full')

    await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: { status: 'cancelled' },
      user: people[0],
      overrideAccess: false,
    })
    expect(await statusOf()).toBe('active')
  })
})
