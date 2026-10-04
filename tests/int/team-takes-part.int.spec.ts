// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

type TestUser = { id: number; email: string; role: string; collection: 'users' }

let municipality: { id: number }
let category: { id: number }
let club: TestUser
let jana: TestUser
let otherAdmin: TestUser
let newcomer: TestUser
let obecOrganizationId: number

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createUser = async (name: string, profile: Record<string, unknown> = {}): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `teampart-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Teampart ${name}`, municipality: municipality.id, notifyEmail: false, ...profile },
    overrideAccess: true,
  })
  return { ...user, collection: 'users' } as TestUser
}

const createEvent = async (owner: TestUser, { capacity = 10, withObec = false } = {}) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Team event ${STAMP}-${eventIds.length}`,
      dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
      locationText: 'Test location',
      lat: 49.5661,
      lng: 15.9403,
      capacity,
      organizer: owner.id,
      municipality: municipality.id,
      categories: [category.id],
      status: 'active',
      isPaid: false,
      isVolunteering: true,
      registrationApprovalMode: 'manual',
    },
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return withObec ? addObec(event.id) : event
}

/** As the obec's accepted co-organizing invitation would. */
const addObec = (eventId: number) =>
  payload.update({
    collection: 'events',
    id: eventId,
    data: { coOrganizations: [obecOrganizationId] },
    context: { coOrganizingApproved: true, skipNotifications: true },
    overrideAccess: true,
  })

const signUp = (eventId: number, user: TestUser) =>
  payload.create({
    collection: 'registrations',
    data: { event: eventId, user: user.id } as never,
    user,
    overrideAccess: false,
  })

const setStatus = (id: number, status: 'approved' | 'rejected' | 'cancelled', user: TestUser) =>
  payload.update({ collection: 'registrations', id, data: { status }, user, overrideAccess: false })

const statusOf = async (id: number) =>
  (await payload.findByID({ collection: 'registrations', id, depth: 0, overrideAccess: true })).status

describe('Whoever runs an event is counted automatically — anywhere else they sign up as themselves', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Teampart Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Teampart Category ${STAMP}` },
      overrideAccess: true,
    })
    club = await createUser('club')
    jana = await createUser('jana', { isVolunteer: true, volunteerMunicipality: municipality.id, volunteerAllowPhone: true, volunteerContactPhone: '+420 600 000 010' })
    otherAdmin = await createUser('otheradmin')
    newcomer = await createUser('newcomer')

    await payload.create({
      collection: 'user-roles',
      data: { user: club.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    for (const admin of [jana, otherAdmin]) {
      await payload.create({
        collection: 'user-roles',
        data: { user: admin.id, municipality: municipality.id, role: 'municipality_admin' },
        overrideAccess: true,
      })
    }
    // The obec's own organization comes with its first obec-run event.
    eventIds.push(
      (
        await payload.create({
          collection: 'events',
          data: {
            title: `Team seed ${STAMP}`,
            dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
            locationText: 'Test location',
            lat: 49.5661,
            lng: 15.9403,
            capacity: 10,
            organizer: otherAdmin.id,
            municipality: municipality.id,
            categories: [category.id],
            status: 'active',
            isPaid: false,
            registrationApprovalMode: 'manual',
          },
          context: { skipNotifications: true },
          overrideAccess: true,
        })
      ).id,
    )
    const organizations = await payload.find({
      collection: 'organizations',
      where: { and: [{ municipality: { equals: municipality.id } }, { type: { equals: 'municipality' } }] },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    obecOrganizationId = organizations.docs[0]!.id
  })

  afterAll(async () => {
    const userIds = [club.id, jana.id, otherAdmin.id, newcomer.id]
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { municipality: { equals: municipality.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('an obec’s admin doesn’t sign up for an event the obec runs or co-organizes — nor help on it as a volunteer', async () => {
    const run = await createEvent(otherAdmin)
    expect(String(typeof run.organization === 'object' ? run.organization?.id : run.organization)).toBe(String(obecOrganizationId))
    await expect(signUp(run.id, jana)).rejects.toThrow(/pořádá vaše obec/)

    const coOrganized = await createEvent(club, { withObec: true })
    await expect(signUp(coOrganized.id, jana)).rejects.toThrow(/pořádá vaše obec/)
    await expect(
      payload.create({
        collection: 'volunteer-invitations',
        data: { kind: 'application', event: coOrganized.id } as never,
        user: jana,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/pořádáte/)
  })

  it('on a club’s event the obec isn’t on, the obec’s admin signs up as themselves — and doesn’t decide about it', async () => {
    const event = await createEvent(club)
    const registration = await signUp(event.id, jana)
    expect(registration.status).toBe('pending')
    expect(typeof registration.user === 'object' ? registration.user.id : registration.user).toBe(jana.id)

    // The obec's admins manage registrations in their obec — just not their own.
    await expect(setStatus(registration.id, 'approved', jana)).rejects.toThrow(/vlastní přihlášce/)
    expect(await statusOf(registration.id)).toBe('pending')

    await setStatus(registration.id, 'approved', club)
    expect(await statusOf(registration.id)).toBe('approved')
    await expect(setStatus(registration.id, 'rejected', jana)).rejects.toThrow(/vlastní přihlášce/)

    // Cancelling it is theirs, like anyone's.
    await setStatus(registration.id, 'cancelled', jana)
    expect(await statusOf(registration.id)).toBe('cancelled')
  })

  it('once the obec co-organizes the event, its admins’ own places on it go', async () => {
    const event = await createEvent(club, { capacity: 1 })
    const registration = await signUp(event.id, jana)
    await setStatus(registration.id, 'approved', club)
    expect((await payload.findByID({ collection: 'events', id: event.id, overrideAccess: true })).status).toBe('full')

    await addObec(event.id)

    expect(await statusOf(registration.id)).toBe('cancelled')
    expect((await payload.findByID({ collection: 'events', id: event.id, overrideAccess: true })).status).toBe('active')
  })

  it('someone made the obec’s admin loses their place on the obec’s events still ahead', async () => {
    const run = await createEvent(otherAdmin)
    const clubs = await createEvent(club)
    const onObecEvent = await signUp(run.id, newcomer)
    const onClubEvent = await signUp(clubs.id, newcomer)

    await payload.create({
      collection: 'user-roles',
      data: { user: newcomer.id, municipality: municipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })

    expect(await statusOf(onObecEvent.id)).toBe('cancelled')
    // Not the obec's event — there they stay signed up as themselves.
    expect(await statusOf(onClubEvent.id)).toBe('pending')
  })
})
