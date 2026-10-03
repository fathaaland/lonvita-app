// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { POST as setVolunteeringRoute } from '@/app/api/events/[id]/volunteering/route'

let payload: Payload

type TestUser = { id: number; email: string; role: string; collection: 'users' }

let municipality: { id: number }
let category: { id: number }
let creator: TestUser
let coOrganizer: TestUser
let outsider: TestUser
let obecAdmin: TestUser
let superadmin: TestUser
let coOrganizationId: number
let outsiderOrganizationId: number

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const eventIds: number[] = []

const createUser = async (name: string, role: 'user' | 'admin' = 'user'): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `ended-${name}-${STAMP}@test.local`, password: 'test1234', role },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Ended ${name}`, municipality: municipality.id, notifyEmail: false },
    overrideAccess: true,
  })
  return { ...user, collection: 'users' } as TestUser
}

/** The creator's event, co-organized by the co-organizer — set up as a trusted write, since a past
 * start can't be created through the app. */
const createEvent = async (startsIn: number, endsIn: number | null = null) => {
  const event = await payload.db.create({
    collection: 'events',
    data: {
      title: `Ended event ${STAMP}-${eventIds.length}`,
      dateTime: new Date(Date.now() + startsIn).toISOString(),
      endDateTime: endsIn === null ? null : new Date(Date.now() + endsIn).toISOString(),
      locationText: 'Test location',
      lat: 49.5661,
      lng: 15.9403,
      capacity: 10,
      organizer: creator.id,
      categories: [category.id],
      municipality: municipality.id,
      status: 'active',
      isPaid: false,
      registrationApprovalMode: 'manual',
      cancellationPolicy: 'none',
      coOrganizations: [coOrganizationId],
      coOrganizers: [coOrganizer.id],
    },
  })
  eventIds.push(event.id)
  return event as { id: number }
}

const editAs = (eventId: number, user: TestUser, title: string) =>
  payload.update({ collection: 'events', id: eventId, data: { title }, user, overrideAccess: false })

const titleOf = async (eventId: number) =>
  (await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })).title

describe('An event that has taken place can’t be edited, whatever the role', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Ended Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Ended Category ${STAMP}` },
      overrideAccess: true,
    })
    creator = await createUser('creator')
    coOrganizer = await createUser('coorganizer')
    outsider = await createUser('outsider')
    obecAdmin = await createUser('obecadmin')
    superadmin = await createUser('superadmin', 'admin')

    for (const user of [creator, coOrganizer, outsider]) {
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: municipality.id, role: 'organizer' },
        overrideAccess: true,
      })
    }
    await payload.create({
      collection: 'user-roles',
      data: { user: obecAdmin.id, municipality: municipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })

    const organizations = await payload.find({
      collection: 'organizations',
      where: { municipality: { equals: municipality.id } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const orgOf = (user: TestUser) =>
      organizations.docs.find((o) => (typeof o.owner === 'object' ? o.owner?.id : o.owner) === user.id)!.id
    coOrganizationId = orgOf(coOrganizer)
    outsiderOrganizationId = orgOf(outsider)
  })

  afterAll(async () => {
    const userIds = [creator.id, coOrganizer.id, outsider.id, obecAdmin.id, superadmin.id]
    await payload.delete({ collection: 'co-organizing-requests', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { municipality: { equals: municipality.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it('nobody edits it — not its creator, a spolupořadatel, the obec nor a platform admin', async () => {
    const event = await createEvent(-2 * DAY)
    const original = await titleOf(event.id)
    for (const user of [creator, coOrganizer, obecAdmin, superadmin]) {
      await expect(editAs(event.id, user, `Changed by ${user.email}`)).rejects.toThrow(/not allowed/)
    }
    expect(await titleOf(event.id)).toBe(original)
    const read = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect(read.status).toBe('finished')
  })

  it('a multi-day event is editable until its end, then no more', async () => {
    const running = await createEvent(-DAY, DAY)
    await editAs(running.id, creator, 'Still running')
    expect(await titleOf(running.id)).toBe('Still running')

    const over = await createEvent(-2 * DAY, -HOUR)
    await expect(editAs(over.id, superadmin, 'Too late')).rejects.toThrow(/not allowed/)
  })

  it('an upcoming event stays editable by everyone who ran it before', async () => {
    const event = await createEvent(7 * DAY)
    for (const user of [creator, coOrganizer, obecAdmin, superadmin]) {
      await editAs(event.id, user, `Edited by ${user.id}`)
      expect(await titleOf(event.id)).toBe(`Edited by ${user.id}`)
    }
  })

  it('its volunteering flag stays as it was, and nobody is invited to co-organize it', async () => {
    const event = await createEvent(-2 * DAY)
    const { token } = await payload.login({ collection: 'users', data: { email: creator.email, password: 'test1234' } })
    const response = await setVolunteeringRoute(
      new Request('http://localhost/api/x', {
        method: 'POST',
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVolunteering: true }),
      }),
      { params: Promise.resolve({ id: String(event.id) }) },
    )
    expect(response.status).toBe(400)

    await expect(
      payload.create({
        collection: 'co-organizing-requests',
        data: { event: event.id, organization: outsiderOrganizationId } as never,
        user: creator,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/smí akci upravovat/)
  })

  it('trusted internal writes still go through', async () => {
    const event = await createEvent(-2 * DAY)
    await payload.update({ collection: 'events', id: event.id, data: { title: 'System write' }, overrideAccess: true })
    expect(await titleOf(event.id)).toBe('System write')
  })
})
