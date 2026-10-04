// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET, POST } from '@/app/api/admin/volunteers/route'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }
type PoolRow = {
  user_id: string
  email: string | null
  phone: string | null
  location: { name: string } | null
  rating: { average: number; count: number } | null
  can_remove: boolean
}

describe('The volunteer pool (GET/POST /api/admin/volunteers)', () => {
  let muniA: { id: number }
  let muniB: { id: number }
  let adminA: TestUser
  let organizerB: TestUser
  let emailOnly: TestUser
  let phoneOnly: TestUser
  let resident: TestUser
  let category: { id: number } | undefined
  let eventId: number | undefined

  const tokenOf = async (user: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })).token

  const listAs = async (user: TestUser) =>
    GET(new Request('http://localhost/api/admin/volunteers', { headers: { Authorization: `JWT ${await tokenOf(user)}` } }))

  const postAs = async (user: TestUser, body: Record<string, unknown>) =>
    POST(
      new Request('http://localhost/api/admin/volunteers', {
        method: 'POST',
        headers: { Authorization: `JWT ${await tokenOf(user)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

  const rowOf = (rows: PoolRow[], user: TestUser) => rows.find((r) => r.user_id === String(user.id))

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muniA = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Pool Muni A ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    muniB = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Pool Muni B ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })

    const makeUser = async (name: string, municipality: { id: number }, profile: Record<string, unknown> = {}) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `pool-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `pool ${name}`, municipality: municipality.id, notifyEmail: false, ...profile },
        overrideAccess: true,
      })
      return user
    }
    adminA = await makeUser('admin-a', muniA)
    organizerB = await makeUser('organizer-b', muniB)
    resident = await makeUser('resident', muniA)
    emailOnly = await makeUser('email-only', muniA, {
      isVolunteer: true,
      volunteerMunicipality: muniA.id,
      volunteerFocus: ['akce'],
      phone: '+420 600 000 001',
      volunteerAllowEmail: true,
      volunteerContactEmail: `pool-contact-${STAMP}@test.local`,
      volunteerAllowPhone: false,
      volunteerContactPhone: '+420 600 000 001',
    })
    phoneOnly = await makeUser('phone-only', muniB, {
      isVolunteer: true,
      volunteerMunicipality: muniB.id,
      volunteerFocus: ['doprava'],
      volunteerAllowPhone: true,
      volunteerContactPhone: '+420 600 000 002',
      volunteerContactEmail: `pool-hidden-${STAMP}@test.local`,
    })

    for (const [user, municipality, role] of [
      [adminA, muniA, 'municipality_admin'],
      [organizerB, muniB, 'organizer'],
    ] as const) {
      await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: municipality.id, role }, overrideAccess: true })
    }
  })

  afterAll(async () => {
    const userIds = [adminA.id, organizerB.id, emailOnly.id, phoneOnly.id, resident.id]
    if (eventId) {
      await payload.delete({ collection: 'registrations', where: { event: { equals: eventId } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'events', id: eventId, overrideAccess: true }).catch(() => {})
    }
    if (category) await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    for (const m of [muniA, muniB]) {
      await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
    }
  })

  it('is one pool for the whole platform — an organizer of another obec sees everyone', async () => {
    const response = await listAs(organizerB)
    expect(response.status).toBe(200)
    const rows = ((await response.json()) as { docs: PoolRow[] }).docs
    expect(rowOf(rows, emailOnly)?.location?.name).toBe(`Test Pool Muni A ${STAMP}`)
    expect(rowOf(rows, emailOnly)?.rating).toBeNull()
    expect(rowOf(rows, phoneOnly)).toBeTruthy()
  })

  it('shows only the channels each volunteer allowed', async () => {
    const rows = ((await (await listAs(adminA)).json()) as { docs: PoolRow[] }).docs
    expect(rowOf(rows, emailOnly)).toMatchObject({ email: `pool-contact-${STAMP}@test.local`, phone: null })
    expect(rowOf(rows, phoneOnly)).toMatchObject({ email: null, phone: '+420 600 000 002' })
  })

  it("is closed to someone who organizes nowhere", async () => {
    expect((await listAs(resident)).status).toBe(403)
  })

  it('nobody is put into the pool by someone else', async () => {
    expect((await postAs(adminA, { userId: resident.id, isVolunteer: true })).status).toBe(400)
  })

  it("an obec's admin takes off only people who help in their obec — and not while they help on an event", async () => {
    const rows = ((await (await listAs(adminA)).json()) as { docs: PoolRow[] }).docs
    expect(rowOf(rows, emailOnly)?.can_remove).toBe(true)
    expect(rowOf(rows, phoneOnly)?.can_remove).toBe(false)

    expect((await postAs(adminA, { userId: phoneOnly.id, isVolunteer: false })).status).toBe(403)
    expect((await postAs(organizerB, { userId: emailOnly.id, isVolunteer: false })).status).toBe(403)

    // Helping on an upcoming event, they're its creator's to decide about — the obec leaves them be.
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Pool Category ${STAMP}` },
      overrideAccess: true,
    })
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Pool Event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizerB.id,
        municipality: muniB.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventId = event.id
    const registration = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: emailOnly.id, role: 'volunteer', status: 'approved' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    const helping = ((await (await listAs(adminA)).json()) as { docs: PoolRow[] }).docs
    expect(rowOf(helping, emailOnly)?.can_remove).toBe(false)
    expect((await postAs(adminA, { userId: emailOnly.id, isVolunteer: false })).status).toBe(409)

    await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: { status: 'cancelled' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    expect((await postAs(adminA, { userId: emailOnly.id, isVolunteer: false })).status).toBe(200)

    const after = ((await (await listAs(adminA)).json()) as { docs: PoolRow[] }).docs
    expect(rowOf(after, emailOnly)).toBeUndefined()
  })
})
