// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET } from '@/app/api/organizations/[id]/feedback-summary/route'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string }

describe("An organization's feedback summary (GET /api/organizations/:id/feedback-summary)", () => {
  let muni: { id: number }
  let cat: { id: number }
  let admin: TestUser
  let pub: TestUser
  let club: TestUser
  let bakery: TestUser
  let anna: TestUser
  let petr: TestUser
  const orgIdOf = new Map<number, number>()
  const eventIds: number[] = []
  const registrationIds: number[] = []
  const relId = (value: number | { id: number }) => (typeof value === 'object' ? value.id : value)

  const createEvent = async (organizer: TestUser, coOrganizers: TestUser[]) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Summary Event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        coOrganizations: coOrganizers.map((u) => orgIdOf.get(u.id)!),
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        cancellationPolicy: 'none',
      },
      user: organizer,
      overrideAccess: false,
    })
    eventIds.push(event.id)
    return event
  }

  const leaveFeedback = async (
    eventId: number,
    participant: TestUser,
    answers: { satisfactionRating: number; feltWelcomeRating?: number; metSomeoneNew?: boolean },
  ) => {
    const registration = await payload.create({
      collection: 'registrations',
      data: { event: eventId, user: participant.id, status: 'approved', attendanceStatus: 'attended' },
      overrideAccess: true,
    })
    registrationIds.push(registration.id)
    await payload.create({
      collection: 'event-feedback',
      data: { registration: registration.id, ...answers },
      overrideAccess: true,
    })
  }

  const summaryAs = async (user: TestUser | null, organizationId: number) => {
    const headers: Record<string, string> = {}
    if (user) {
      const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
      headers.Authorization = `JWT ${token}`
    }
    return GET(new Request(`http://localhost/api/organizations/${organizationId}/feedback-summary`, { headers }), {
      params: Promise.resolve({ id: String(organizationId) }),
    })
  }

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Summary Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Summary ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, role: string) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `summary-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `summary ${name}`, municipality: muni.id, notifyEmail: false },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: muni.id, role: role as 'organizer' },
        overrideAccess: true,
      })
      return user
    }
    admin = await makeUser('admin', 'municipality_admin')
    pub = await makeUser('hospoda', 'organizer')
    club = await makeUser('spolek', 'organizer')
    bakery = await makeUser('pekarna', 'organizer')
    anna = await makeUser('anna', 'participant')
    petr = await makeUser('petr', 'participant')

    const orgs = await payload.find({
      collection: 'organizations',
      where: { and: [{ municipality: { equals: muni.id } }, { type: { not_equals: 'municipality' } }] },
      depth: 0,
      overrideAccess: true,
    })
    for (const o of orgs.docs) orgIdOf.set(relId(o.owner!), o.id)

    // The pub runs a quiz with the club; the bakery runs its own tasting.
    const quiz = await createEvent(pub, [club])
    const tasting = await createEvent(bakery, [])
    await leaveFeedback(quiz.id, anna, { satisfactionRating: 5, feltWelcomeRating: 4, metSomeoneNew: true })
    await leaveFeedback(quiz.id, petr, { satisfactionRating: 3, metSomeoneNew: false })
    await leaveFeedback(tasting.id, anna, { satisfactionRating: 1, feltWelcomeRating: 1, metSomeoneNew: false })
  })

  afterAll(async () => {
    const userIds = [admin.id, pub.id, club.id, bakery.id, anna.id, petr.id]
    await payload.delete({ collection: 'event-feedback', where: { registration: { in: registrationIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { id: { in: registrationIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  it("gives the owner the aggregate of their events' feedback — nobody's single answer", async () => {
    const response = await summaryAs(pub, orgIdOf.get(pub.id)!)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      count: 2,
      avg_satisfaction: 4,
      avg_felt_welcome: 4,
      met_someone_new_share: 0.5,
    })
    expect(JSON.stringify(body)).not.toContain('summary anna')
  })

  it('counts the events the organization co-organizes too', async () => {
    const body = await (await summaryAs(club, orgIdOf.get(club.id)!)).json()
    expect(body).toMatchObject({ count: 2, avg_satisfaction: 4 })
  })

  it("keeps other organizations' events out", async () => {
    const body = await (await summaryAs(bakery, orgIdOf.get(bakery.id)!)).json()
    expect(body).toMatchObject({ count: 1, avg_satisfaction: 1, met_someone_new_share: 0 })
  })

  it("lets the obec's admin see any organization of the obec", async () => {
    expect((await summaryAs(admin, orgIdOf.get(pub.id)!)).status).toBe(200)
  })

  it('refuses another organizer, a participant and an anonymous visitor', async () => {
    expect((await summaryAs(bakery, orgIdOf.get(pub.id)!)).status).toBe(403)
    expect((await summaryAs(anna, orgIdOf.get(pub.id)!)).status).toBe(403)
    expect((await summaryAs(null, orgIdOf.get(pub.id)!)).status).toBe(401)
  })

  it("answers 404 for an organization that doesn't exist", async () => {
    expect((await summaryAs(pub, 999_999_999)).status).toBe(404)
  })
})
