// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

// Edits enqueue notifications — not under test here.
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

describe('Event capacity vs. approved participants (Events syncCapacityStatus)', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: { id: number; email: string; role: string }
  const participants: { id: number }[] = []
  let event: { id: number }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni Capacity ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `Capacity ${STAMP}` }, overrideAccess: true })
    organizer = (await payload.create({
      collection: 'users',
      data: { email: `capacity-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as typeof organizer
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    event = await payload.create({
      collection: 'events',
      data: {
        title: `Capacity ${STAMP}`,
        dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 5,
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
    for (let i = 0; i < 3; i++) {
      const user = await payload.create({
        collection: 'users',
        data: { email: `capacity-p${i}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      participants.push(user)
      await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: user.id, status: 'approved' },
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true }).catch(() => {})
    for (const user of [...participants, organizer]) {
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('refuses a capacity below the approved participants', async () => {
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { capacity: 2 }, user: organizer, overrideAccess: false }),
    ).rejects.toThrow(/pod počet schválených účastníků \(3\)/)
  })

  it('turns the event full when the capacity comes down to the approved count, and active again above it', async () => {
    const full = await payload.update({ collection: 'events', id: event.id, data: { capacity: 3 }, user: organizer, overrideAccess: false })
    expect(full.status).toBe('full')
    const active = await payload.update({ collection: 'events', id: event.id, data: { capacity: 6 }, user: organizer, overrideAccess: false })
    expect(active.status).toBe('active')
  })

  it('a write without a user (the import syncing a calendar) is recounted, not refused', async () => {
    const synced = await payload.update({ collection: 'events', id: event.id, data: { capacity: 2 }, overrideAccess: true })
    expect(synced.capacity).toBe(2)
    expect(synced.status).toBe('full')
  })
})
