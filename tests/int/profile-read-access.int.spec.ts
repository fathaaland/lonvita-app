import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// Profiles (name, photo, home obec) aren't a directory of everyone. Readable: your own; the people
// who organize events — they're the event's public face; whoever is signed up for, or invited to
// help on, an event you run; and, for an obec's admin, its residents and whoever holds or asks for
// a role there. A platform admin reads them all.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe('Who may read whose profile', () => {
  let muniA: { id: number }
  let muniB: { id: number }
  let category: { id: number }
  let organizer: TestUser
  let coOrganizer: TestUser
  let participant: TestUser
  let otherParticipant: TestUser
  let volunteer: TestUser
  let adminA: TestUser
  let adminB: TestUser
  let applicant: TestUser
  let stranger: TestUser
  let platformAdmin: TestUser
  const users: TestUser[] = []
  const eventIds: number[] = []

  const makeUser = async (name: string, home: { id: number } | null, role: 'user' | 'admin' = 'user') => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `profile-read-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Read ${name}`, municipality: home?.id ?? null, notifyEmail: false },
      overrideAccess: true,
    })
    users.push(user)
    return user
  }

  const role = (user: TestUser, municipality: { id: number }, value: 'organizer' | 'municipality_admin') =>
    payload.create({ collection: 'user-roles', data: { user: user.id, municipality: municipality.id, role: value }, overrideAccess: true })

  /** Whose profiles `viewer` gets back when asking for all of these. */
  const readableBy = async (viewer: TestUser, of: TestUser[]) => {
    const result = await payload.find({
      collection: 'profiles',
      where: { user: { in: of.map((u) => u.id) } },
      depth: 0,
      pagination: false,
      user: viewer,
      overrideAccess: false,
    })
    return result.docs
      .map((p) => users.find((u) => u.id === (typeof p.user === 'object' ? p.user.id : p.user)))
      .filter((u): u is TestUser => Boolean(u))
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const muni = (name: string) =>
      payload.create({
        collection: 'municipalities',
        data: { name: `Profile Read ${name} ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
        overrideAccess: true,
      })
    muniA = await muni('A')
    muniB = await muni('B')
    category = await payload.create({ collection: 'event-categories', data: { name: `Profile Read ${STAMP}` }, overrideAccess: true })

    organizer = await makeUser('organizer', muniA)
    coOrganizer = await makeUser('co-organizer', muniA)
    participant = await makeUser('participant', muniA)
    otherParticipant = await makeUser('other-participant', muniB)
    volunteer = await makeUser('volunteer', muniB)
    adminA = await makeUser('admin-a', muniA)
    adminB = await makeUser('admin-b', muniB)
    applicant = await makeUser('applicant', muniB)
    stranger = await makeUser('stranger', null)
    platformAdmin = await makeUser('platform-admin', null, 'admin')

    await role(organizer, muniA, 'organizer')
    await role(adminA, muniA, 'municipality_admin')
    await role(adminB, muniB, 'municipality_admin')
    // Asks to organize in A while living in B.
    await payload.create({
      collection: 'organizer-requests',
      data: { user: applicant.id, municipality: muniA.id, reason: 'Chci pořádat akce pro sousedy.', organizationName: 'Sousedé', organizationType: 'individual', status: 'pending' },
      overrideAccess: true,
    })

    const event = await payload.db.create({
      collection: 'events',
      data: {
        title: `Profile Read ${STAMP}`,
        dateTime: new Date(Date.now() + 3 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        coOrganizers: [coOrganizer.id],
        municipality: muniA.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'auto',
      },
    })
    eventIds.push(event.id)
    for (const user of [participant, otherParticipant]) {
      await payload.db.create({ collection: 'registrations', data: { event: event.id, user: user.id, status: 'approved', role: 'participant' } })
    }
    await payload.db.create({
      collection: 'volunteer-invitations',
      data: { event: event.id, eventTitle: event.title, volunteer: volunteer.id, invitedBy: organizer.id, status: 'pending', kind: 'invitation' },
    })
  })

  afterAll(async () => {
    const userIds = users.map((u) => u.id)
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizer-requests', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    for (const m of [muniA, muniB]) await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
  })

  it("can't list everyone — a stranger reads only their own and the organizers'", async () => {
    expect(new Set(await readableBy(stranger, users))).toEqual(new Set([stranger, organizer, coOrganizer]))
  })

  it("a participant doesn't see who else is signed up", async () => {
    expect(await readableBy(participant, [otherParticipant, volunteer])).toEqual([])
  })

  it("the event's team reads its registrants and the volunteers it invited", async () => {
    for (const team of [organizer, coOrganizer]) {
      expect(new Set(await readableBy(team, [participant, otherParticipant, volunteer]))).toEqual(
        new Set([participant, otherParticipant, volunteer]),
      )
    }
  })

  it("an obec's admin reads its residents, its events' people and who asks for a role there — not another obec's residents", async () => {
    expect(new Set(await readableBy(adminA, [participant, otherParticipant, applicant, adminB]))).toEqual(
      new Set([participant, otherParticipant, applicant]),
    )
    expect(new Set(await readableBy(adminB, [participant, otherParticipant, applicant]))).toEqual(
      new Set([otherParticipant, applicant]),
    )
  })

  it('a platform admin reads everyone', async () => {
    expect(await readableBy(platformAdmin, users)).toHaveLength(users.length)
  })
})
