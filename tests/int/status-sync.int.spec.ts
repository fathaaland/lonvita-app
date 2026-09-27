// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

// Event writes enqueue notifications and reminders; none of that is under test here, and the sync
// itself must not enqueue anything.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))
vi.mock('@/collections/shared/reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collections/shared/reminders')>()),
  rescheduleEventReminders: vi.fn(async () => undefined),
  cancelEventReminders: vi.fn(async () => undefined),
}))

import { enqueueEmail, enqueueEventCancelled, enqueueEventUpdated } from '@/lib/queue/queues'

import { processSyncStatusesJob } from '../../worker/src/processors/sync-statuses.processor'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('Finished/expired status sync (worker cron)', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: { id: number }
  const eventIds: number[] = []
  const requestIds: number[] = []

  /** Created in the future (as the collection requires), then moved to `times` straight in the
   * database — the clock passing it by, with no hooks involved. */
  const createEvent = async (
    times: { dateTime: string; endDateTime?: string | null },
    status: 'active' | 'full' | 'cancelled' = 'active',
  ) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Status sync event ${STAMP}`,
        dateTime: new Date(Date.now() + 3 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        cancellationPolicy: 'none',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventIds.push(event.id)
    await payload.db.updateOne({
      collection: 'events',
      id: event.id,
      data: { ...times, endDateTime: times.endDateTime ?? null, status },
    })
    return event
  }

  const createDeletionRequest = async (expiresAt: string) => {
    const request = await payload.db.create({
      collection: 'event-deletion-requests',
      data: { eventTitle: `Status sync request ${STAMP}`, requestedBy: organizer.id, status: 'pending', expiresAt },
    })
    requestIds.push(request.id as number)
    return request
  }

  /** The stored value, bypassing the afterRead hooks that derive it. */
  const rawStatus = async (collection: 'events' | 'event-deletion-requests', id: number | string) =>
    ((await payload.db.findOne({ collection, where: { id: { equals: id } } })) as { status?: string } | null)?.status

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
  const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Status Sync ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Status Sync ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `status-sync-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    for (const id of requestIds) {
      await payload.delete({ collection: 'event-deletion-requests', id, overrideAccess: true }).catch(() => {})
    }
    for (const id of eventIds) {
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'user-roles', where: { user: { equals: organizer.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: organizer.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives "finished" on read without writing it back', async () => {
    const event = await createEvent({ dateTime: ago(3 * HOUR), endDateTime: ago(HOUR) })

    const read = await payload.findByID({ collection: 'events', id: event.id, overrideAccess: true })
    expect(read.status).toBe('finished')
    // Give a stray fire-and-forget write a moment to land, if there were one.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await rawStatus('events', event.id)).toBe('active')
  })

  it('persists "finished" for active/full events that are over, and nothing else', async () => {
    const endedActive = await createEvent({ dateTime: ago(3 * HOUR), endDateTime: ago(HOUR) })
    const endedFull = await createEvent({ dateTime: ago(3 * HOUR), endDateTime: ago(HOUR) }, 'full')
    const startedNoEnd = await createEvent({ dateTime: ago(HOUR) })
    const running = await createEvent({ dateTime: ago(HOUR), endDateTime: ahead(HOUR) })
    const upcoming = await createEvent({ dateTime: ahead(DAY) })
    const cancelled = await createEvent({ dateTime: ago(3 * HOUR), endDateTime: ago(HOUR) }, 'cancelled')
    const before = await payload.db.findOne<{ id: number; updatedAt: string }>({
      collection: 'events',
      where: { id: { equals: endedActive.id } },
    })

    const result = await processSyncStatusesJob()

    expect(result.eventsFinished).toBeGreaterThanOrEqual(3)
    expect(await rawStatus('events', endedActive.id)).toBe('finished')
    expect(await rawStatus('events', endedFull.id)).toBe('finished')
    expect(await rawStatus('events', startedNoEnd.id)).toBe('finished')
    expect(await rawStatus('events', running.id)).toBe('active')
    expect(await rawStatus('events', upcoming.id)).toBe('active')
    expect(await rawStatus('events', cancelled.id)).toBe('cancelled')

    // The clock moving isn't an edit: no hooks, no notifications, updatedAt untouched.
    const after = await payload.db.findOne<{ id: number; updatedAt: string }>({
      collection: 'events',
      where: { id: { equals: endedActive.id } },
    })
    expect(after?.updatedAt).toBe(before?.updatedAt)
    expect(enqueueEventUpdated).not.toHaveBeenCalled()
    expect(enqueueEventCancelled).not.toHaveBeenCalled()
    expect(enqueueEmail).not.toHaveBeenCalled()
  })

  it('expires pending deletion requests past their deadline and leaves the rest', async () => {
    const overdue = await createDeletionRequest(ago(HOUR))
    const open = await createDeletionRequest(ahead(DAY))

    const result = await processSyncStatusesJob()

    expect(result.deletionRequestsExpired).toBeGreaterThanOrEqual(1)
    expect(await rawStatus('event-deletion-requests', overdue.id)).toBe('expired')
    expect(await rawStatus('event-deletion-requests', open.id)).toBe('pending')
  })

  it('is a no-op on a second run', async () => {
    const event = await createEvent({ dateTime: ago(3 * HOUR), endDateTime: ago(HOUR) })
    await processSyncStatusesJob()
    expect(await rawStatus('events', event.id)).toBe('finished')

    const again = await processSyncStatusesJob()
    expect(again.eventsFinished).toBe(0)
  })
})
