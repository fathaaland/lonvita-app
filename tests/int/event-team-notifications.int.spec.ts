import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest'

let payload: Payload

type TestUser = { id: number; email: string; role: string; collection: 'users' }

let municipality: { id: number }
let category: { id: number }
let organizer: TestUser
let coOrganizer: TestUser
let obecAdmin: TestUser
let participant: TestUser
let coOrganization: { id: number }
let obecOrganizationId: number

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createUser = async (name: string): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `team-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Team ${name}`, municipality: municipality.id, onboardingCompleted: true },
    overrideAccess: true,
  })
  return { ...user, collection: 'users' } as TestUser
}

/** The organizer's event, co-organized by `coOrganizer`'s organization — and by the obec too when
 * `withObec` (coOrganizations set as the accepted invitations would, `coOrganizingApproved`). */
const createTeamEvent = async ({ withObec = false } = {}) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Team event ${STAMP}-${eventIds.length}`,
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
  eventIds.push(event.id)
  return payload.update({
    collection: 'events',
    id: event.id,
    data: { coOrganizations: withObec ? [coOrganization.id, obecOrganizationId] : [coOrganization.id] },
    context: { coOrganizingApproved: true, skipNotifications: true },
    overrideAccess: true,
  })
}

const notificationsTitled = async (title: string) =>
  (
    await payload.find({
      collection: 'notifications',
      where: {
        and: [
          { title: { equals: title } },
          { user: { in: [organizer.id, coOrganizer.id, obecAdmin.id, participant.id] } },
        ],
      },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
  ).docs

const recipientsOf = (docs: { user: number | { id: number } }[]) =>
  docs.map((n) => (typeof n.user === 'object' ? n.user.id : n.user)).sort((a, b) => a - b)

describe("Notifications about an event reach everyone running it", () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Team Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Team Category ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await createUser('organizer')
    coOrganizer = await createUser('coorganizer')
    obecAdmin = await createUser('obecadmin')
    participant = await createUser('participant')

    for (const user of [organizer, coOrganizer]) {
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
    coOrganization = organizations.docs.find(
      (o) => (typeof o.owner === 'object' ? o.owner?.id : o.owner) === coOrganizer.id,
    )!
    obecOrganizationId = organizations.docs.find((o) => o.type === 'municipality')!.id
  })

  afterEach(async () => {
    await payload.delete({
      collection: 'notifications',
      where: { user: { in: [organizer.id, coOrganizer.id, obecAdmin.id, participant.id] } },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const userIds = [organizer.id, coOrganizer.id, obecAdmin.id, participant.id]
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it("a participant cancelling tells the pořadatel and every spolupořadatel who it was, with their e-mail", async () => {
    const event = await createTeamEvent()
    const reg = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'approved' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })

    await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { status: 'cancelled' },
      user: participant,
      overrideAccess: true,
    })

    const sent = await notificationsTitled('Přihláška zrušena')
    expect(recipientsOf(sent)).toEqual([organizer.id, coOrganizer.id].sort((a, b) => a - b))
    for (const notification of sent) {
      expect(notification.message).toContain(participant.email)
      expect(notification.message).toContain('Team participant')
      expect(notification.link).toBe(`/spravovat/${event.id}`)
    }
  })

  it("with the obec co-organizing, its admins are told too", async () => {
    const event = await createTeamEvent({ withObec: true })
    const reg = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'approved' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })

    await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { status: 'cancelled' },
      user: participant,
      overrideAccess: true,
    })

    const sent = await notificationsTitled('Přihláška zrušena')
    expect(recipientsOf(sent)).toEqual([organizer.id, coOrganizer.id, obecAdmin.id].sort((a, b) => a - b))
  })

  it("whoever on the team cancelled it isn't told about their own doing — the rest are", async () => {
    const event = await createTeamEvent()
    const reg = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'approved' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })

    await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { status: 'cancelled' },
      user: organizer,
      overrideAccess: true,
    })

    expect(recipientsOf(await notificationsTitled('Přihláška zrušena'))).toEqual([coOrganizer.id])
  })

  it('a new registration reaches the whole team and opens the manage page', async () => {
    const event = await createTeamEvent({ withObec: true })

    await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id },
      user: participant,
      overrideAccess: true,
    })

    const sent = await notificationsTitled('Nová přihláška na akci')
    expect(recipientsOf(sent)).toEqual([organizer.id, coOrganizer.id, obecAdmin.id].sort((a, b) => a - b))
    expect(sent.every((n) => n.link === `/spravovat/${event.id}`)).toBe(true)
    for (const notification of sent) {
      expect(notification.message).toContain('Team participant')
      expect(notification.message).toContain(participant.email)
    }
  })

  it("a spolupořadatel's edit is announced to the other organizers", async () => {
    const event = await createTeamEvent()

    await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: `${event.title} (upraveno)` },
      user: coOrganizer,
      overrideAccess: true,
    })

    // In-app writes of the edit hook are awaited, but give the fire-and-forget ones a moment.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const sent = await notificationsTitled('Společná akce byla upravena')
    expect(recipientsOf(sent)).toEqual([organizer.id])
    expect(sent[0].link).toBe(`/akce/${event.id}`)
    expect(sent[0].message).toContain('Team coorganizer')
  })
})
