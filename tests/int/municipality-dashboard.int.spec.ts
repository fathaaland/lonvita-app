// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as getDashboard } from '@/app/api/municipalities/[id]/dashboard/route'
import { toEventRow, type FeedbackRow, type RegistrationRow } from '@/lib/analytics'
import { computeMunicipalityDashboard } from '@/lib/dashboard'
import { relationId } from '@/lib/relations'

import type { ProfileWithDob } from '@/lib/report'

// The obec's dashboard is worked out on the server now — it must show exactly what the page used
// to work out itself from the rows the obec's admin could read over REST.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const daysFrom = (days: number) => new Date(Date.now() + days * DAY).toISOString()

type TestUser = { id: number; email: string; role?: string }

describe('The obec dashboard (GET /api/municipalities/:id/dashboard)', () => {
  let muni: { id: number }
  let otherMuni: { id: number }
  let cat: { id: number }
  let obecAdmin: TestUser
  let organizer: TestUser
  let outsider: TestUser
  let platformAdmin: TestUser
  const people: TestUser[] = []
  const userIds: number[] = []
  const eventIds: number[] = []
  const registrationIds: number[] = []

  const makeUser = async (name: string, role: 'municipality_admin' | 'organizer' | null, profile: Record<string, unknown> = {}, platformRole: 'user' | 'admin' = 'user') => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `dash-${name}-${STAMP}@test.local`, password: 'test1234', role: platformRole },
      overrideAccess: true,
    })
    userIds.push(user.id)
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Dash ${name}`, municipality: muni.id, notifyEmail: false, ...profile },
      overrideAccess: true,
    })
    if (role) await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
    return user as TestUser
  }

  /** Trusted writes — past events and marked attendance can't be made through the app. */
  const makeEvent = async (name: string, startsIn: number, organizerId: number, extra: Record<string, unknown> = {}) => {
    const event = await payload.db.create({
      collection: 'events',
      data: {
        title: `Dash ${name} ${STAMP}`,
        dateTime: daysFrom(startsIn),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizerId,
        categories: [cat.id],
        municipality: muni.id,
        status: startsIn < 0 ? 'finished' : 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        coOrganizations: [],
        coOrganizers: [],
        ...extra,
      },
    })
    eventIds.push(event.id)
    return event.id as number
  }

  const register = async (event: number, user: TestUser, status: string, extra: Record<string, unknown> = {}) => {
    const registration = await payload.db.create({
      collection: 'registrations',
      data: { event, user: user.id, status, role: 'participant', ...extra },
    })
    registrationIds.push(registration.id)
    return registration.id as number
  }

  const ask = async (viewer: TestUser | null, municipalityId: number, scope = 'all') => {
    const headers: Record<string, string> = {}
    if (viewer) {
      const { token } = await payload.login({ collection: 'users', data: { email: viewer.email, password: 'test1234' } })
      headers.Authorization = `JWT ${token}`
    }
    return getDashboard(new Request(`http://localhost/api/municipalities/${municipalityId}/dashboard?scope=${scope}`, { headers }), {
      params: Promise.resolve({ id: String(municipalityId) }),
    })
  }

  /** What admin-obce used to load over REST as the obec's admin — the same queries, the same access
   * — and work out in the browser. */
  const asThePageDid = async (viewer: TestUser, organizerId?: number) => {
    const as = { user: viewer, overrideAccess: false, depth: 0, pagination: false } as const
    const events = (await payload.find({ collection: 'events', where: { municipality: { equals: muni.id } }, ...as })).docs
      .map(toEventRow)
      .filter((e) => organizerId === undefined || e.organizer_id === String(organizerId))
    const ids = events.map((e) => e.id)
    const registrations: RegistrationRow[] = ids.length
      ? (await payload.find({ collection: 'registrations', where: { event: { in: ids } }, ...as })).docs.map((r) => ({
          id: String(r.id),
          event_id: relationId(r.event)!,
          user_id: relationId(r.user)!,
          status: r.status,
          created_at: r.createdAt,
          attendance_status: (r.attendanceStatus ?? 'not_marked') as RegistrationRow['attendance_status'],
          role: r.role ?? 'participant',
        }))
      : []
    const feedback: FeedbackRow[] = registrations.length
      ? (await payload.find({ collection: 'event-feedback', where: { registration: { in: registrations.map((r) => r.id) } }, ...as })).docs.map(
          (f) => ({
            id: String(f.id),
            registration_id: relationId(f.registration)!,
            satisfaction_rating: f.satisfactionRating,
            felt_welcome_rating: f.feltWelcomeRating ?? null,
          }),
        )
      : []
    const profiles: ProfileWithDob[] = (await payload.find({ collection: 'profiles', where: { municipality: { equals: muni.id } }, ...as })).docs.map(
      (p) => ({
        id: String(p.id),
        user_id: relationId(p.user) ?? '',
        full_name: p.fullName,
        created_at: p.createdAt,
        date_of_birth: p.dateOfBirth ?? null,
        over_50: Boolean(p.over50),
      }),
    )
    const categories = (await payload.find({ collection: 'event-categories', depth: 0, pagination: false, overrideAccess: true })).docs.map((c) => ({
      id: String(c.id),
      name: c.name,
      icon: c.icon ?? '',
      color: c.color ?? '',
    }))
    return JSON.parse(JSON.stringify(computeMunicipalityDashboard({ events, registrations, profiles, categories, feedback })))
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Dashboard Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    otherMuni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Dashboard Other ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({ collection: 'event-categories', data: { name: `Test Category Dashboard ${STAMP}` }, overrideAccess: true })
    obecAdmin = await makeUser('admin', 'municipality_admin')
    organizer = await makeUser('organizer', 'organizer')
    outsider = await makeUser('outsider', null)
    platformAdmin = await makeUser('platform', null, {}, 'admin')
    for (const [i, dob] of ['1950-03-01', '1948-07-12', '1990-01-01', '1960-11-30'].entries()) {
      people.push(await makeUser(`p${i}`, null, { dateOfBirth: dob }))
    }

    const past = await makeEvent('past', -10, organizer.id)
    const adminsPast = await makeEvent('admins past', -40, obecAdmin.id, { isVolunteering: true })
    const upcoming = await makeEvent('upcoming', 5, organizer.id)
    await makeEvent('cancelled', -5, organizer.id, { status: 'cancelled' })

    const attended = await register(past, people[0], 'approved', { attendanceStatus: 'attended' })
    await register(past, people[1], 'approved', { attendanceStatus: 'no_show' })
    await register(past, people[2], 'cancelled', { selfCancelled: true })
    await register(past, people[3], 'pending')
    await register(adminsPast, people[0], 'approved', { attendanceStatus: 'attended' })
    await register(adminsPast, people[2], 'approved', { attendanceStatus: 'attended', role: 'volunteer' })
    await register(upcoming, people[1], 'pending')
    await register(upcoming, people[3], 'approved')
    await payload.db.create({ collection: 'event-feedback', data: { registration: attended, satisfactionRating: 4, feltWelcomeRating: 5 } })
  })

  afterAll(async () => {
    const quiet = <T>(p: Promise<T>) => p.catch(() => {})
    await quiet(payload.delete({ collection: 'event-feedback', where: { registration: { in: registrationIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'organizations', where: { municipality: { in: [muni.id, otherMuni.id] } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'municipalities', where: { id: { in: [muni.id, otherMuni.id] } }, overrideAccess: true }))
  })

  it('is for the obec’s admin and a platform admin only', async () => {
    expect((await ask(null, muni.id)).status).toBe(401)
    expect((await ask(outsider, muni.id)).status).toBe(403)
    expect((await ask(organizer, muni.id)).status).toBe(403)
    expect((await ask(obecAdmin, otherMuni.id)).status).toBe(403)
    expect((await ask(obecAdmin, muni.id)).status).toBe(200)
    expect((await ask(platformAdmin, muni.id)).status).toBe(200)
  })

  it('shows exactly what the page used to work out from the rows it read', async () => {
    const response = await ask(obecAdmin, muni.id)
    const { municipalityName, ...dashboard } = await response.json()
    expect(municipalityName).toBe(`Test Dashboard Muni ${STAMP}`)
    expect(dashboard).toEqual(await asThePageDid(obecAdmin))
    // …and the numbers are the real ones: two held events with an approved participant each (the
    // cancelled one left out), one rating, nobody's place counted twice.
    expect(dashboard.periods.all.kpis.eventsTotal).toBe(3)
    expect(dashboard.ratings).toMatchObject({ count: 1, avgSatisfaction: 4, avgFeltWelcome: 5 })
    expect(dashboard.events.find((e: { title: string }) => e.title === `Dash past ${STAMP}`)).toMatchObject({
      approved: 2,
      organizer_name: 'Dash organizer',
    })
  })

  it('“Jen moje akce” narrows it to the viewer’s own events', async () => {
    const response = await ask(obecAdmin, muni.id, 'mine')
    const { municipalityName: _, ...dashboard } = await response.json()
    expect(dashboard).toEqual(await asThePageDid(obecAdmin, obecAdmin.id))
    expect(dashboard.events.map((e: { title: string }) => e.title)).toEqual([`Dash admins past ${STAMP}`])
  })

  it('sends no registrations to the browser — only the numbers', async () => {
    const body = await (await ask(obecAdmin, muni.id)).json()
    expect(body).not.toHaveProperty('registrations')
    expect(body).not.toHaveProperty('profiles')
    expect(JSON.stringify(body)).not.toContain('1950-03-01')
  })
})
