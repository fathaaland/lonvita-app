import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

let municipality: { id: number }
let category: { id: number }
let organizer: { id: number }

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const eventIds: number[] = []

const createEventStartingIn = async (ms: number) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Cancellation window ${STAMP}`,
      dateTime: new Date(Date.now() + ms).toISOString(),
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
      cancellationPolicy: 'none',
    },
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event
}

const cancel = (id: number) =>
  payload.update({
    collection: 'events',
    id,
    data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
    overrideAccess: true,
  })

describe('Event cancellation window — at the latest 3 hours before the start', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Cancellation ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Cancellation ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `cancel-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    // An event's organizer always holds the role in its obec (Events.requireOrganizerRole).
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    for (const id of eventIds) {
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'users', id: organizer.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('cancels an event that starts more than 3 hours from now', async () => {
    const event = await createEventStartingIn(3 * HOUR + 10 * 60 * 1000)
    const cancelled = await cancel(event.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.deletedAt).toBeTruthy()
  })

  it('refuses to cancel an event that starts within 3 hours', async () => {
    const event = await createEventStartingIn(2 * HOUR)
    await expect(cancel(event.id)).rejects.toThrow(/nejpozději 3 hodiny/)
  })

  it('still allows ordinary edits inside the window', async () => {
    const event = await createEventStartingIn(HOUR)
    const updated = await payload.update({
      collection: 'events',
      id: event.id,
      data: { description: 'Upravený popis' },
      overrideAccess: true,
    })
    expect(updated.description).toBe('Upravený popis')
  })
})
