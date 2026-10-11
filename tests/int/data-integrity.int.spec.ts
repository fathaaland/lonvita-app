// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

import { MULTI_DAY_END_MESSAGE } from '@/lib/date'
import { PHONE_TAKEN_MESSAGE } from '@/lib/phone'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type TestUser = { id: number; email: string; role: string }

const users: TestUser[] = []
const municipalityIds: number[] = []
let category: { id: number }

const createUser = async (name: string): Promise<TestUser> => {
  const user = (await payload.create({
    collection: 'users',
    data: { email: `integrity-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })) as TestUser
  users.push(user)
  return user
}

const createProfile = (user: TestUser, municipality?: { id: number }) =>
  payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Integrity ${user.id}`, municipality: municipality?.id ?? null },
    overrideAccess: true,
  })

const createMunicipality = async (name: string) => {
  const municipality = await payload.create({
    collection: 'municipalities',
    data: { name: `Integrity ${name} ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
    overrideAccess: true,
  })
  municipalityIds.push(municipality.id)
  return municipality
}

const grant = (user: TestUser, municipality: { id: number }, role: 'organizer' | 'municipality_admin') =>
  payload.create({
    collection: 'user-roles',
    data: { user: user.id, municipality: municipality.id, role },
    overrideAccess: true,
  })

const eventData = (organizer: TestUser, municipality: { id: number }, startsIn: number, endsIn: number | null = null) => ({
  title: `Integrity event ${STAMP}`,
  dateTime: new Date(Date.now() + startsIn).toISOString(),
  endDateTime: endsIn === null ? null : new Date(Date.now() + endsIn).toISOString(),
  locationText: 'Náves',
  lat: 49.5661,
  lng: 15.9403,
  capacity: 10,
  organizer: organizer.id,
  municipality: municipality.id,
  categories: [category.id],
  status: 'active' as const,
  isPaid: false,
  registrationApprovalMode: 'manual' as const,
})

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  category = await payload.create({
    collection: 'event-categories',
    data: { name: `Integrity category ${STAMP}` },
    overrideAccess: true,
  })
})

afterAll(async () => {
  const userIds = users.map((u) => u.id)
  for (const id of municipalityIds) {
    await payload.db.updateMany({
      collection: 'events',
      where: { municipality: { equals: id } },
      data: { status: 'cancelled' },
    }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
  }
  await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
  await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
  await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
  await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
})

describe('A phone number belongs to one account', () => {
  let first: { id: number }
  let second: { id: number }

  beforeAll(async () => {
    first = await createProfile(await createUser('phone-a'))
    second = await createProfile(await createUser('phone-b'))
  })

  const setPhone = (profile: { id: number }, phone: string | null) =>
    payload.update({ collection: 'profiles', id: profile.id, data: { phone }, overrideAccess: true })

  it('is stored in E.164, however it was typed', async () => {
    const updated = await setPhone(first, '735 929 442')
    expect(updated.phone).toBe('+420735929442')
  })

  it("can't be taken by another account — not even written differently", async () => {
    await expect(setPhone(second, '+420 735 929 442')).rejects.toThrow(PHONE_TAKEN_MESSAGE)
    await expect(setPhone(second, '00420735929442')).rejects.toThrow(PHONE_TAKEN_MESSAGE)
  })

  it('stays with its owner, who may save it again', async () => {
    const updated = await setPhone(first, '+420735929442')
    expect(updated.phone).toBe('+420735929442')
  })

  it('a number nobody has is fine, an unreadable one is not', async () => {
    expect((await setPhone(second, '735 929 443')).phone).toBe('+420735929443')
    await expect(setPhone(second, 'abc')).rejects.toThrow()
  })
})

describe('An obec admin appointed after an organizer asked', () => {
  let obec: { id: number }
  let applicant: TestUser
  let admin: TestUser
  let request: { id: number }

  beforeAll(async () => {
    obec = await createMunicipality('new-admin')
    applicant = await createUser('applicant')
    admin = await createUser('new-admin')
    await createProfile(applicant)
    await createProfile(admin)
    request = await payload.create({
      collection: 'organizer-requests',
      data: {
        user: applicant.id,
        municipality: obec.id,
        reason: 'Vedu v obci kroužek pletení pro seniory.',
        organizationName: `Pletení ${STAMP}`,
        organizationType: 'association',
      },
      user: applicant,
      overrideAccess: false,
    })
  })

  it('is told what already waits on the obec', async () => {
    await grant(admin, obec, 'municipality_admin')
    await vi.waitFor(
      async () => {
        const notifications = await payload.find({
          collection: 'notifications',
          where: { and: [{ user: { equals: admin.id } }, { title: { equals: 'Na vyřízení čekají žádosti' } }] },
          overrideAccess: true,
        })
        expect(notifications.docs).toHaveLength(1)
        expect(notifications.docs[0].message).toContain('žádosti o roli organizátora: 1')
        expect(notifications.docs[0].link).toBe('/admin-obce?tab=requests')
      },
      { timeout: 5000 },
    )
  })

  it('approving grants the role and the organization together, and the decision is final', async () => {
    await payload.update({
      collection: 'organizer-requests',
      id: request.id,
      data: { status: 'approved' },
      user: admin,
      overrideAccess: false,
    })
    const roles = await payload.count({
      collection: 'user-roles',
      where: { and: [{ user: { equals: applicant.id } }, { municipality: { equals: obec.id } }, { role: { equals: 'organizer' } }] },
      overrideAccess: true,
    })
    expect(roles.totalDocs).toBe(1)

    await expect(
      payload.update({
        collection: 'organizer-requests',
        id: request.id,
        data: { status: 'rejected' },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow('O žádosti už bylo rozhodnuto.')
  })
})

describe('A multi-day event ends on a later day', () => {
  let obec: { id: number }
  let organizer: TestUser

  beforeAll(async () => {
    obec = await createMunicipality('multi-day')
    organizer = await createUser('multi-day-organizer')
    await grant(organizer, obec, 'organizer')
  })

  it('refuses an end on the day it starts', async () => {
    // 09:00 → 17:00 on the same Prague day, a few days ahead.
    const start = new Date(Date.now() + 3 * DAY)
    start.setUTCHours(7, 0, 0, 0)
    const end = new Date(start.getTime() + 8 * HOUR)
    await expect(
      payload.create({
        collection: 'events',
        data: { ...eventData(organizer, obec, 0), dateTime: start.toISOString(), endDateTime: end.toISOString() },
        overrideAccess: true,
        context: { skipNotifications: true },
      }),
    ).rejects.toThrow(MULTI_DAY_END_MESSAGE)
  })

  it('takes an end on a following day', async () => {
    const event = await payload.create({
      collection: 'events',
      data: eventData(organizer, obec, 3 * DAY, 4 * DAY),
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    expect(event.endDateTime).toBeTruthy()
  })

  it('leaves an older same-day event editable as long as its dates stay', async () => {
    const start = new Date(Date.now() + 5 * DAY)
    start.setUTCHours(7, 0, 0, 0)
    const legacy = await payload.db.create({
      collection: 'events',
      data: {
        ...eventData(organizer, obec, 0),
        dateTime: start.toISOString(),
        endDateTime: new Date(start.getTime() + 2 * HOUR).toISOString(),
      },
    })
    const renamed = await payload.update({
      collection: 'events',
      id: legacy.id,
      data: { title: `Renamed ${STAMP}` },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    expect(renamed.title).toBe(`Renamed ${STAMP}`)
  })
})

describe('Deleting takes what belongs to it along', () => {
  let obec: { id: number }
  let organizer: TestUser
  let participant: TestUser
  let resident: { id: number }

  beforeAll(async () => {
    obec = await createMunicipality('cascade')
    organizer = await createUser('cascade-organizer')
    participant = await createUser('cascade-participant')
    resident = await createProfile(participant, obec)
    await grant(organizer, obec, 'organizer')
  })

  it("an event's registrations and open deletion requests go with it", async () => {
    const event = await payload.create({
      collection: 'events',
      data: eventData(organizer, obec, 2 * DAY),
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'approved' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    await payload.db.create({
      collection: 'event-deletion-requests',
      data: {
        event: event.id,
        eventTitle: event.title,
        municipality: obec.id,
        requestedBy: organizer.id,
        status: 'pending',
        expiresAt: new Date(Date.now() + DAY).toISOString(),
      },
    })

    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true, context: { skipNotifications: true } })

    const [registrations, requests] = await Promise.all([
      payload.count({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true }),
      payload.count({ collection: 'event-deletion-requests', where: { event: { equals: event.id } }, overrideAccess: true }),
    ])
    expect(registrations.totalDocs).toBe(0)
    expect(requests.totalDocs).toBe(0)
  })

  it("an obec can't go while an event ahead still stands", async () => {
    await payload.create({
      collection: 'events',
      data: eventData(organizer, obec, 2 * DAY),
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    await expect(payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true })).rejects.toThrow(
      /nadcházejících akcí/,
    )
  })

  it('an obec takes its events, roles and organizations along; residents keep their accounts', async () => {
    await payload.db.updateMany({ collection: 'events', where: { municipality: { equals: obec.id } }, data: { status: 'cancelled' } })

    await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true })

    const ofObec = { municipality: { equals: obec.id } }
    const [events, roles, organizations] = await Promise.all([
      payload.count({ collection: 'events', where: ofObec, overrideAccess: true }),
      payload.count({ collection: 'user-roles', where: ofObec, overrideAccess: true }),
      payload.db.count({ collection: 'organizations', where: ofObec }),
    ])
    expect(events.totalDocs).toBe(0)
    expect(roles.totalDocs).toBe(0)
    expect(organizations.totalDocs).toBe(0)
    const profile = await payload.findByID({ collection: 'profiles', id: resident.id, depth: 0, overrideAccess: true })
    expect(profile.municipality ?? null).toBeNull()
  })
})
