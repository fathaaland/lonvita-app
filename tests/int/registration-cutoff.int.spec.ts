import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest'

import { GET as getOrganizerContact } from '@/app/api/events/[id]/organizer-contact/route'

let payload: Payload

let municipality: { id: number }
let category: { id: number }
let organizer: { id: number; email: string; role: string }
let participant: { id: number; email: string; role: string }
let stranger: { id: number; email: string; role: string }

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const eventIds: number[] = []

const createEventStartingIn = async (ms: number) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Excuse ${STAMP}`,
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
    },
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event
}

const register = (eventId: number, status: 'pending' | 'approved' = 'approved') =>
  payload.create({
    collection: 'registrations',
    data: { event: eventId, user: participant.id, status },
    context: { skipNotifications: true },
    overrideAccess: true,
  })

/** The participant signing up through access control, as the REST API does. */
const signUp = (eventId: number) =>
  payload.create({
    collection: 'registrations',
    data: { event: eventId, user: participant.id, status: 'pending' },
    user: participant,
    overrideAccess: false,
  })

/** The participant cancelling their own registration through access control, as the REST API does. */
const cancelOwn = (id: number, excuseMessage?: string) =>
  payload.update({
    collection: 'registrations',
    id,
    data: excuseMessage === undefined ? { status: 'cancelled' } : { status: 'cancelled', excuseMessage },
    user: participant,
    overrideAccess: false,
  })

const organizerNotifications = async () =>
  (
    await payload.find({
      collection: 'notifications',
      where: { user: { equals: organizer.id } },
      overrideAccess: true,
    })
  ).docs

const contactAs = async (user: { id: number }, eventId: number) => {
  const { token } = await payload.login({
    collection: 'users',
    data: { email: user.id === participant.id ? participant.email : stranger.email, password: 'test1234' },
  })
  return getOrganizerContact(
    new Request(`http://localhost/api/events/${eventId}/organizer-contact`, {
      headers: { Authorization: `JWT ${token}` },
    }),
    { params: Promise.resolve({ id: String(eventId) }) },
  )
}

describe('Signing up and cancelling (with an omluvenka) close 3 hours before the event', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Excuse ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Excuse ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `excuse-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    participant = await payload.create({
      collection: 'users',
      data: { email: `excuse-participant-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    stranger = await payload.create({
      collection: 'users',
      data: { email: `excuse-stranger-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'profiles',
      data: { user: organizer.id, fullName: 'Pořadatelka Omluvenek', phone: '+420 777 123 456' },
      overrideAccess: true,
    })
  })

  afterEach(async () => {
    await payload.delete({ collection: 'notifications', where: { user: { equals: organizer.id } }, overrideAccess: true })
    await payload.delete({ collection: 'registrations', where: { user: { equals: participant.id } }, overrideAccess: true })
    await payload.delete({ collection: 'volunteer-invitations', where: { volunteer: { equals: participant.id } }, overrideAccess: true })
  })

  afterAll(async () => {
    for (const id of eventIds) {
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'profiles', where: { user: { equals: organizer.id } }, overrideAccess: true }).catch(() => {})
    for (const user of [organizer, participant, stranger]) {
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('sends the excuse to the organizer when cancelling more than 3 hours before', async () => {
    const event = await createEventStartingIn(5 * HOUR)
    const reg = await register(event.id)

    const cancelled = await cancelOwn(reg.id, '  Jsem nemocná, omlouvám se.  ')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.excuseMessage).toBe('Jsem nemocná, omlouvám se.')
    expect(cancelled.cancelledAt).toBeTruthy()

    const notifications = await organizerNotifications()
    const excuse = notifications.find((n) => n.title === 'Omluvenka z akce')
    expect(excuse?.message).toContain('Jsem nemocná, omlouvám se.')
  })

  it('refuses cancelling within 3 hours of the start — with or without an excuse, approved or pending', async () => {
    const event = await createEventStartingIn(2 * HOUR)

    const approved = await register(event.id)
    await expect(cancelOwn(approved.id, 'Nestihnu to.')).rejects.toThrow(/Odhlásit se z akce lze nejpozději 3 hodiny/)
    await expect(cancelOwn(approved.id)).rejects.toThrow(/Odhlásit se z akce lze nejpozději 3 hodiny/)
    expect((await payload.findByID({ collection: 'registrations', id: approved.id, overrideAccess: true })).status).toBe(
      'approved',
    )
    await payload.delete({ collection: 'registrations', id: approved.id, overrideAccess: true })

    const pending = await register(event.id, 'pending')
    await expect(cancelOwn(pending.id)).rejects.toThrow(/Odhlásit se z akce lze nejpozději 3 hodiny/)
    expect(await organizerNotifications()).toHaveLength(0)
  })

  it('still lets the organizer take someone off the event within 3 hours', async () => {
    const event = await createEventStartingIn(2 * HOUR)
    const reg = await register(event.id)

    const removed = await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { status: 'rejected' },
      user: organizer,
      overrideAccess: false,
    })
    expect(removed.status).toBe('rejected')
  })

  it('takes the excuse only along with the registrant cancelling their own registration', async () => {
    const event = await createEventStartingIn(5 * HOUR)
    const reg = await register(event.id)

    // Not without cancelling…
    await expect(
      payload.update({
        collection: 'registrations',
        id: reg.id,
        data: { excuseMessage: 'Jen tak.' },
        user: participant,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/Omluvenku posílá jen přihlášený sám/)

    // …nor on someone else's behalf.
    await expect(
      payload.update({
        collection: 'registrations',
        id: reg.id,
        data: { status: 'cancelled', excuseMessage: 'Za něj.' },
        user: organizer,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/Omluvenku posílá jen přihlášený sám/)

    // Once sent, it stays as it was.
    await cancelOwn(reg.id, 'Původní omluvenka.')
    const later = await payload.update({
      collection: 'registrations',
      id: reg.id,
      data: { excuseMessage: 'Přepsaná.' },
      overrideAccess: true,
    })
    expect(later.excuseMessage).toBe('Původní omluvenka.')
  })

  it('lets them sign up more than 3 hours before the start', async () => {
    const event = await createEventStartingIn(5 * HOUR)
    const reg = await signUp(event.id)
    expect(reg.status).toBe('pending')
  })

  it('refuses signing up within 3 hours of the start', async () => {
    const event = await createEventStartingIn(2 * HOUR)
    await expect(signUp(event.id)).rejects.toThrow(/Přihlásit se na akci lze nejpozději 3 hodiny/)
  })

  it('refuses offering help as a volunteer within 3 hours of the start', async () => {
    const event = await createEventStartingIn(2 * HOUR)
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { isVolunteering: true },
      context: { skipNotifications: true },
      overrideAccess: true,
    })

    await expect(
      payload.create({
        collection: 'volunteer-invitations',
        data: { kind: 'application', event: event.id } as never,
        user: participant,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/Pomoc lze nabídnout nejpozději 3 hodiny/)
  })

  it("shows the organizer's contact to a registrant — and to anyone once sign-up has closed", async () => {
    const open = await createEventStartingIn(5 * HOUR)
    await register(open.id)

    const ok = await contactAs(participant, open.id)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({
      name: 'Pořadatelka Omluvenek',
      email: organizer.email,
      phone: '+420 777 123 456',
    })
    expect((await contactAs(stranger, open.id)).status).toBe(403)

    // Too late to sign up in the app — whoever still wants to come needs to reach the organizer.
    const closed = await createEventStartingIn(2 * HOUR)
    expect((await contactAs(stranger, closed.id)).status).toBe(200)
  })
})
