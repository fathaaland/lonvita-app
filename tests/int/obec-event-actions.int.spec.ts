import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

let municipality: { id: number; name: string }
let category: { id: number }
let organizer: { id: number; email: string; role: string }
let obecAdmin: { id: number; email: string; role: string }

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createOrganizersEvent = async () => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Organizer's event ${STAMP}-${eventIds.length}`,
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
      cancellationPolicy: 'none',
    },
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event
}

const organizerNotifications = async () =>
  (
    await payload.find({
      collection: 'notifications',
      where: { user: { equals: organizer.id } },
      sort: '-createdAt',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
  ).docs

describe("The obec's admin acting on an organizer's event notifies the organizer", () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Obec Test ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Obec ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `obec-actions-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    obecAdmin = await payload.create({
      collection: 'users',
      data: { email: `obec-actions-admin-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
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
  })

  afterAll(async () => {
    await payload.delete({ collection: 'notifications', where: { user: { in: [organizer.id, obecAdmin.id] } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: [organizer.id, obecAdmin.id] } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { municipality: { equals: municipality.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: [organizer.id, obecAdmin.id] } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('an edit by the obec admin tells the organizer what changed', async () => {
    const event = await createOrganizersEvent()
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: `Renamed by the obec ${STAMP}`, isHidden: true },
      user: obecAdmin,
      overrideAccess: false,
    })

    const [latest] = await organizerNotifications()
    expect(latest.title).toBe('Obec upravila vaši akci')
    expect(latest.message).toContain(municipality.name)
    expect(latest.message).toContain('název')
    expect(latest.message).toContain('zveřejnění')
    expect(latest.link).toBe(`/akce/${event.id}`)
  })

  it("the organizer's own edit doesn't", async () => {
    const event = await createOrganizersEvent()
    const before = (await organizerNotifications()).length
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: `Renamed by the organizer ${STAMP}` },
      user: organizer,
      overrideAccess: false,
    })
    expect((await organizerNotifications()).length).toBe(before)
  })

  it('cancelling by the obec admin tells the organizer', async () => {
    const event = await createOrganizersEvent()
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
      user: obecAdmin,
      overrideAccess: false,
    })

    const [latest] = await organizerNotifications()
    expect(latest.title).toBe('Obec zrušila vaši akci')
    expect(latest.message).toContain(event.title)
  })

  it('deleting by the obec admin tells the organizer', async () => {
    const event = await createOrganizersEvent()
    await payload.delete({ collection: 'events', id: event.id, user: obecAdmin, overrideAccess: false })

    const [latest] = await organizerNotifications()
    expect(latest.title).toBe('Obec smazala vaši akci')
    expect(latest.message).toContain(event.title)
  })
})
