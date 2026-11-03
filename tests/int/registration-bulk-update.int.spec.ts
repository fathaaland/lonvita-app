// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest'

let payload: Payload

let municipality: { id: number }
let category: { id: number }
let organizer: { id: number; email: string; role: string }
let participant: { id: number; email: string; role: string }
let other: { id: number; email: string; role: string }

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createEvent = async (extra: Record<string, unknown> = {}) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Bulk ${STAMP}`,
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
      ...extra,
    } as never,
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event
}

const register = (eventId: number, status: 'pending' | 'approved' | 'rejected' = 'pending') =>
  payload.create({
    collection: 'registrations',
    data: { event: eventId, user: participant.id, status },
    context: { skipNotifications: true },
    overrideAccess: true,
  })

const statusOf = async (id: number) =>
  (await payload.findByID({ collection: 'registrations', id, depth: 0, overrideAccess: true })).status

/** The registrant's own bulk PATCH /api/registrations?where[id][equals]=…, through access control. */
const bulkAsParticipant = (id: number, data: Record<string, unknown>) =>
  payload.update({
    collection: 'registrations',
    where: { id: { equals: id } },
    data,
    user: participant,
    overrideAccess: false,
  })

describe('A registrant cannot get past the registration rules with a bulk update', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Bulk ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Bulk ${STAMP}` },
      overrideAccess: true,
    })
    const makeUser = (name: string) =>
      payload.create({
        collection: 'users',
        data: { email: `bulk-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
    organizer = await makeUser('organizer')
    participant = await makeUser('participant')
    other = await makeUser('other')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
  })

  afterEach(async () => {
    await payload.delete({ collection: 'registrations', where: { user: { in: [participant.id, other.id] } }, overrideAccess: true })
  })

  afterAll(async () => {
    for (const id of eventIds) {
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    for (const user of [organizer, participant, other]) {
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('refuses self-approving a pending registration on an event with approval', async () => {
    const event = await createEvent()
    const reg = await register(event.id, 'pending')

    await expect(bulkAsParticipant(reg.id, { status: 'approved' })).rejects.toMatchObject({ status: 403 })
    expect(await statusOf(reg.id)).toBe('pending')
  })

  it("refuses lifting the organizer's rejection", async () => {
    const event = await createEvent()
    const reg = await register(event.id, 'rejected')

    await expect(bulkAsParticipant(reg.id, { status: 'approved' })).rejects.toMatchObject({ status: 403 })
    await expect(bulkAsParticipant(reg.id, { status: 'cancelled' })).rejects.toMatchObject({ status: 403 })
    expect(await statusOf(reg.id)).toBe('rejected')
  })

  it('refuses a bulk update even for the organizer — one registration at a time', async () => {
    const event = await createEvent()
    const reg = await register(event.id, 'pending')

    await expect(
      payload.update({
        collection: 'registrations',
        where: { event: { equals: event.id } },
        data: { status: 'approved' },
        user: organizer,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await statusOf(reg.id)).toBe('pending')
  })

  it("doesn't let the registrant move their registration to another event or hand it to someone else", async () => {
    const event = await createEvent()
    const elsewhere = await createEvent({ capacity: 1 })
    const reg = await register(event.id, 'approved')

    const moved = await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { event: elsewhere.id, user: other.id },
      user: participant,
      overrideAccess: false,
    })
    const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : v)
    expect(relId(moved.event)).toBe(event.id)
    expect(relId(moved.user)).toBe(participant.id)
  })

  it('still lets the registrant cancel their own registration and the organizer approve one', async () => {
    const event = await createEvent()
    const reg = await register(event.id, 'pending')

    const approved = await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { status: 'approved' },
      user: organizer,
      overrideAccess: false,
    })
    expect(approved.status).toBe('approved')

    const cancelled = await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { status: 'cancelled' },
      user: participant,
      overrideAccess: false,
    })
    expect(cancelled.status).toBe('cancelled')
  })
})
