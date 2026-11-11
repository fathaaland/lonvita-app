// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const CAPACITY = 5
const RUSH = 20

/** A rush on one event without approval: everyone signs up in the same moment. The capacity check
 * holds the event row (Registrations beforeValidate); the 'full' status is written after the commit
 * (syncEventFullStatus). Neither may let more in than there are places, nor leave the event 'active'. */
describe('Sign-up rush on one event (auto approval)', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: { id: number }
  let event: { id: number }
  const people: { id: number; email: string }[] = []

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Rush ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `Rush ${STAMP}` }, overrideAccess: true })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `rush-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    event = await payload.create({
      collection: 'events',
      data: {
        title: `Rush ${STAMP}`,
        dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: CAPACITY,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'auto',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    for (let i = 0; i < RUSH; i++) {
      people.push(
        (await payload.create({
          collection: 'users',
          data: { email: `rush-p${i}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
          overrideAccess: true,
        })) as { id: number; email: string },
      )
    }
  }, 120_000)

  afterAll(async () => {
    await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true }).catch(() => {})
    for (const user of [...people, organizer]) {
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
  })

  it(`takes exactly ${CAPACITY} of ${RUSH} simultaneous sign-ups and ends 'full'`, async () => {
    const results = await Promise.allSettled(
      people.map((person) =>
        payload.create({
          collection: 'registrations',
          data: { event: event.id, user: person.id } as never,
          overrideAccess: false,
          user: { ...person, collection: 'users' },
          depth: 0,
        }),
      ),
    )
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(CAPACITY)
    for (const r of refused) expect(String(r.reason?.message)).toContain('Akce je plná')

    const approved = await payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: event.id } }, { status: { equals: 'approved' } }] },
      overrideAccess: true,
    })
    expect(approved.totalDocs).toBe(CAPACITY)

    const after = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect(after.status).toBe('full')
  }, 120_000)
})
