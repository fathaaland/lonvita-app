import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

type TestUser = { id: number; email: string; role: string; collection: 'users' }

let municipality: { id: number }
let category: { id: number }
let creator: TestUser
let coOrganizer: TestUser
let obecAdmin: TestUser
let volunteer: TestUser
let coOrganization: { id: number }
let obecOrganizationId: number

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createUser = async (name: string, profile: Record<string, unknown> = {}): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `volcreator-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Volcreator ${name}`, municipality: municipality.id, notifyEmail: false, ...profile },
    overrideAccess: true,
  })
  return { ...user, collection: 'users' } as TestUser
}

/** `owner`'s event, co-organized by `coOrganizer`'s organization — and by the obec too when
 * `withObec` (set as the accepted invitations would, `coOrganizingApproved`). */
const createEvent = async (owner: TestUser, { withObec = false, coOrganized = true } = {}) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Volunteering event ${STAMP}-${eventIds.length}`,
      dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
      locationText: 'Test location',
      lat: 49.5661,
      lng: 15.9403,
      capacity: 10,
      organizer: owner.id,
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
  const coOrganizations = [...(coOrganized ? [coOrganization.id] : []), ...(withObec ? [obecOrganizationId] : [])]
  if (coOrganizations.length === 0) return event
  return payload.update({
    collection: 'events',
    id: event.id,
    data: { coOrganizations },
    context: { coOrganizingApproved: true, skipNotifications: true },
    overrideAccess: true,
  })
}

const setVolunteering = (eventId: number, user: TestUser, isVolunteering: boolean) =>
  payload.update({ collection: 'events', id: eventId, data: { isVolunteering }, user, overrideAccess: false })

const flagOf = async (eventId: number) =>
  (await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })).isVolunteering

const requestFlag = (eventId: number, user: TestUser) =>
  payload.create({
    collection: 'volunteer-flag-requests',
    data: { event: eventId, requestedBy: user.id },
    user,
    overrideAccess: false,
  })

const createVolunteeringEvent = async (owner: TestUser, options: { withObec?: boolean } = {}) => {
  const event = await createEvent(owner, options)
  return payload.update({
    collection: 'events',
    id: event.id,
    data: { isVolunteering: true },
    context: { skipVolunteeringGuard: true, skipNotifications: true },
    overrideAccess: true,
  })
}

const offerHelp = (eventId: number, user: TestUser, message?: string) =>
  payload.create({
    collection: 'volunteer-invitations',
    data: { kind: 'application', event: eventId, message } as never,
    user,
    overrideAccess: false,
  })

const decide = (id: number, status: 'accepted' | 'declined' | 'withdrawn', user: TestUser) =>
  payload.update({ collection: 'volunteer-invitations', id, data: { status }, user, overrideAccess: false })

const notificationsFor = async (user: TestUser, title: string) =>
  (
    await payload.find({
      collection: 'notifications',
      where: { and: [{ user: { equals: user.id } }, { title: { equals: title } }] },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
  ).docs

const invite = (eventId: number, user: TestUser) =>
  payload.create({
    collection: 'volunteer-invitations',
    data: { event: eventId, volunteer: volunteer.id } as never,
    user,
    overrideAccess: false,
  })

describe('Volunteering on an event is its creator’s alone', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Volcreator Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Volcreator Category ${STAMP}` },
      overrideAccess: true,
    })
    creator = await createUser('creator')
    coOrganizer = await createUser('coorganizer')
    obecAdmin = await createUser('obecadmin')
    volunteer = await createUser('volunteer', {
      isVolunteer: true,
      volunteerMunicipality: municipality.id,
      volunteerAllowPhone: true,
      volunteerContactPhone: '+420 600 000 009',
    })

    for (const user of [creator, coOrganizer]) {
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
    coOrganization = organizations.docs.find((o) => (typeof o.owner === 'object' ? o.owner?.id : o.owner) === coOrganizer.id)!
    obecOrganizationId = organizations.docs.find((o) => o.type === 'municipality')!.id
  })

  afterAll(async () => {
    const userIds = [creator.id, coOrganizer.id, obecAdmin.id, volunteer.id]
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'volunteer-flag-requests', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it('neither a spolupořadatel nor the obec admin can put the flag on someone else’s event', async () => {
    const event = await createEvent(creator)
    await setVolunteering(event.id, coOrganizer, true)
    expect(await flagOf(event.id)).toBe(false)
    await setVolunteering(event.id, obecAdmin, true)
    expect(await flagOf(event.id)).toBe(false)
  })

  it('only the creator may ask the obec for it — and the obec’s approval puts it on', async () => {
    const event = await createEvent(creator, { withObec: true })
    await expect(requestFlag(event.id, coOrganizer)).rejects.toThrow(/založil/)
    await expect(requestFlag(event.id, obecAdmin)).rejects.toThrow(/založil/)

    // Filed under whoever is signed in, whatever the client names.
    const request = await payload.create({
      collection: 'volunteer-flag-requests',
      data: { event: event.id, requestedBy: coOrganizer.id },
      user: creator,
      overrideAccess: false,
    })
    expect(typeof request.requestedBy === 'object' ? request.requestedBy.id : request.requestedBy).toBe(creator.id)
    await expect(requestFlag(event.id, creator)).rejects.toThrow(/čeká/)

    await payload.update({
      collection: 'volunteer-flag-requests',
      id: request.id,
      data: { status: 'approved' },
      user: obecAdmin,
      overrideAccess: false,
    })
    expect(await flagOf(event.id)).toBe(true)
  })

  it('a creator who administers the obec sets it straight away', async () => {
    const event = await createEvent(obecAdmin)
    await setVolunteering(event.id, obecAdmin, true)
    expect(await flagOf(event.id)).toBe(true)
  })

  it('a spolupořadatel can’t take it off; the creator and the obec can', async () => {
    const event = await createEvent(creator)
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { isVolunteering: true },
      context: { skipVolunteeringGuard: true },
      overrideAccess: true,
    })
    await setVolunteering(event.id, coOrganizer, false)
    expect(await flagOf(event.id)).toBe(true)
    await setVolunteering(event.id, obecAdmin, false)
    expect(await flagOf(event.id)).toBe(false)
  })

  it('only the creator invites volunteers — even when the obec has locked them out of editing', async () => {
    const event = await createEvent(creator, { withObec: true })
    await expect(invite(event.id, coOrganizer)).rejects.toThrow(/založil/)
    await expect(invite(event.id, obecAdmin)).rejects.toThrow(/založil/)
    const invitation = await invite(event.id, creator)
    expect(invitation.status).toBe('pending')
  })

  it('a volunteer from the pool offers to help — the creator is asked, with the volunteer’s rating', async () => {
    const event = await createVolunteeringEvent(creator, { withObec: true })
    const offer = await offerHelp(event.id, volunteer, 'Můžu odvézt dva lidi.')
    expect(offer).toMatchObject({ kind: 'application', status: 'pending' })
    expect(typeof offer.invitedBy === 'object' ? offer.invitedBy.id : offer.invitedBy).toBe(creator.id)
    expect(typeof offer.volunteer === 'object' ? offer.volunteer.id : offer.volunteer).toBe(volunteer.id)

    await new Promise((resolve) => setTimeout(resolve, 200))
    const [notification] = await notificationsFor(creator, 'Dobrovolník nabízí pomoc')
    expect(notification.message).toContain('Volcreator volunteer')
    expect(notification.message).toContain('zatím bez hodnocení')
    expect(notification.link).toBe(`/spravovat/${event.id}`)
    // Asking twice, or being invited meanwhile, isn't possible while it waits.
    await expect(offerHelp(event.id, volunteer)).rejects.toThrow(/čeká/)
    await expect(invite(event.id, creator)).rejects.toThrow(/nabídl/)
  })

  it('only events looking for volunteers, and only people in the pool', async () => {
    const plain = await createEvent(creator)
    await expect(offerHelp(plain.id, volunteer)).rejects.toThrow(/nehledá/)
    const event = await createVolunteeringEvent(creator)
    await expect(offerHelp(event.id, obecAdmin)).rejects.toThrow(/poolu/)
    await expect(offerHelp(event.id, coOrganizer)).rejects.toThrow()
  })

  it('only the creator answers — accepting makes them a volunteer on the event', async () => {
    const event = await createVolunteeringEvent(creator, { withObec: true })
    const offer = await offerHelp(event.id, volunteer)

    await expect(decide(offer.id, 'accepted', volunteer)).rejects.toThrow()
    await expect(decide(offer.id, 'accepted', coOrganizer)).rejects.toThrow()
    await expect(decide(offer.id, 'accepted', obecAdmin)).rejects.toThrow()

    const accepted = await decide(offer.id, 'accepted', creator)
    expect(accepted.status).toBe('accepted')
    const registration = await payload.findByID({
      collection: 'registrations',
      id: typeof accepted.registration === 'object' ? accepted.registration!.id : accepted.registration!,
      depth: 0,
      overrideAccess: true,
    })
    expect(registration).toMatchObject({ role: 'volunteer', status: 'approved' })

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await notificationsFor(volunteer, 'Pořadatel přijal vaši pomoc')).toHaveLength(1)
  })

  it('the volunteer may withdraw their offer; the creator may decline one', async () => {
    const first = await createVolunteeringEvent(creator)
    const withdrawn = await decide((await offerHelp(first.id, volunteer)).id, 'withdrawn', volunteer)
    expect(withdrawn.status).toBe('withdrawn')

    const second = await createVolunteeringEvent(creator)
    const offer = await offerHelp(second.id, volunteer)
    await expect(decide(offer.id, 'withdrawn', creator)).rejects.toThrow()
    expect((await decide(offer.id, 'declined', creator)).status).toBe('declined')

    // An invitation stays the volunteer's to answer — the creator can't accept it for them.
    const third = await createVolunteeringEvent(creator)
    const invitation = await invite(third.id, creator)
    await expect(decide(invitation.id, 'accepted', creator)).rejects.toThrow()
  })
})
