// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as listPool } from '@/app/api/admin/volunteers/route'
import { GET as volunteerCard } from '@/app/api/volunteers/[userId]/route'
import { POST as setAccessRoute } from '@/app/api/user-roles/[id]/volunteer-access/route'

let payload: Payload

type TestUser = { id: number; email: string; role: string; collection: 'users' }

let municipality: { id: number }
let category: { id: number }
let obecAdmin: TestUser
let withAccess: TestUser
let withoutAccess: TestUser
let applicantAll: TestUser
let applicantRole: TestUser
let applicantNoPool: TestUser
let applicantRejected: TestUser
let volunteer: TestUser

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []
const userIds: number[] = []

const createUser = async (name: string, profile: Record<string, unknown> = {}): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `poolaccess-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Poolaccess ${name}`, municipality: municipality.id, notifyEmail: false, ...profile },
    overrideAccess: true,
  })
  userIds.push(user.id)
  return { ...user, collection: 'users' } as TestUser
}

const grantRole = (user: TestUser, role: 'organizer' | 'municipality_admin', volunteerAccess = false) =>
  payload.create({
    collection: 'user-roles',
    data: { user: user.id, municipality: municipality.id, role, volunteerAccess },
    overrideAccess: true,
  })

const organizerRole = async (user: TestUser) =>
  (
    await payload.find({
      collection: 'user-roles',
      where: { and: [{ user: { equals: user.id } }, { municipality: { equals: municipality.id } }, { role: { equals: 'organizer' } }] },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]

const tokenOf = async (user: TestUser) =>
  (await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })).token

const authed = async (user: TestUser, url: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { Authorization: `JWT ${await tokenOf(user)}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })

const createEvent = async (owner: TestUser) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Pool access event ${STAMP}-${eventIds.length}`,
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
    },
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event
}

const requestRole = (user: TestUser, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'organizer-requests',
    data: {
      user: user.id,
      municipality: municipality.id,
      reason: 'Vedu místní spolek a chci pořádat akce.',
      organizationName: `Spolek ${user.id}`,
      organizationType: 'association',
      ...extra,
    } as never,
    user,
    overrideAccess: false,
  })

const decide = (id: number, data: Record<string, unknown>, user: TestUser = obecAdmin) =>
  payload.update({ collection: 'organizer-requests', id, data: data as never, user, overrideAccess: false })

describe('Volunteer pool access is the obec’s to grant', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Poolaccess Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Poolaccess Category ${STAMP}` },
      overrideAccess: true,
    })
    obecAdmin = await createUser('obecadmin')
    withAccess = await createUser('with')
    withoutAccess = await createUser('without')
    applicantAll = await createUser('applicant-all')
    applicantRole = await createUser('applicant-role')
    applicantNoPool = await createUser('applicant-nopool')
    applicantRejected = await createUser('applicant-rejected')
    volunteer = await createUser('volunteer', {
      isVolunteer: true,
      volunteerMunicipality: municipality.id,
      volunteerAllowPhone: true,
      volunteerContactPhone: '+420 600 000 019',
    })

    await grantRole(obecAdmin, 'municipality_admin')
    await grantRole(withAccess, 'organizer', true)
    await grantRole(withoutAccess, 'organizer')
  })

  afterAll(async () => {
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizer-requests', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it('an organizer without access neither lists the pool nor opens a volunteer’s card; the obec admin and a let-in organizer do', async () => {
    expect((await listPool(await authed(withoutAccess, 'http://localhost/api/admin/volunteers'))).status).toBe(403)
    const card = async (u: TestUser) =>
      volunteerCard(await authed(u, `http://localhost/api/volunteers/${volunteer.id}`), {
        params: Promise.resolve({ userId: String(volunteer.id) }),
      })
    expect((await card(withoutAccess)).status).toBe(403)

    for (const user of [obecAdmin, withAccess]) {
      const response = await listPool(await authed(user, 'http://localhost/api/admin/volunteers'))
      expect(response.status).toBe(200)
      const docs = ((await response.json()) as { docs: { user_id: string }[] }).docs
      expect(docs.some((d) => d.user_id === String(volunteer.id))).toBe(true)
      expect((await card(user)).status).toBe(200)
    }
  })

  it('an organizer can’t give the access to themselves — not on their role, nor through the endpoint', async () => {
    const role = await organizerRole(withoutAccess)
    await expect(
      payload.update({ collection: 'user-roles', id: role.id, data: { volunteerAccess: true }, user: withoutAccess, overrideAccess: false }),
    ).rejects.toThrow()

    const response = await setAccessRoute(
      await authed(withoutAccess, `http://localhost/api/user-roles/${role.id}/volunteer-access`, {
        method: 'POST',
        body: JSON.stringify({ volunteerAccess: true }),
      }),
      { params: Promise.resolve({ id: String(role.id) }) },
    )
    expect(response.status).toBe(403)
    expect((await organizerRole(withoutAccess)).volunteerAccess).toBe(false)
  })

  it('a platform admin sets it for any organizer — another obec’s admin can’t', async () => {
    const superAdmin = await payload.create({
      collection: 'users',
      data: { email: `poolaccess-super-${STAMP}@test.local`, password: 'test1234', role: 'admin' },
      overrideAccess: true,
    })
    userIds.push(superAdmin.id)
    const otherObec = await payload.create({
      collection: 'municipalities',
      data: { name: `Poolaccess Other ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    const otherAdmin = await createUser('other-admin')
    await payload.create({
      collection: 'user-roles',
      data: { user: otherAdmin.id, municipality: otherObec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })

    const role = await organizerRole(withoutAccess)
    const setAs = async (user: TestUser, volunteerAccess: boolean) =>
      setAccessRoute(
        await authed(user, `http://localhost/api/user-roles/${role.id}/volunteer-access`, {
          method: 'POST',
          body: JSON.stringify({ volunteerAccess }),
        }),
        { params: Promise.resolve({ id: String(role.id) }) },
      )

    expect((await setAs(otherAdmin, true)).status).toBe(403)
    expect((await organizerRole(withoutAccess)).volunteerAccess).toBe(false)

    const asSuper = { ...superAdmin, collection: 'users' } as TestUser
    expect((await setAs(asSuper, true)).status).toBe(200)
    expect((await organizerRole(withoutAccess)).volunteerAccess).toBe(true)
    expect((await setAs(asSuper, false)).status).toBe(200)
    expect((await organizerRole(withoutAccess)).volunteerAccess).toBe(false)

    await payload.delete({ collection: 'user-roles', where: { user: { equals: otherAdmin.id } }, overrideAccess: true })
    await payload
      .delete({ collection: 'municipalities', id: otherObec.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it('a request can’t come granted, and the applicant can’t decide it', async () => {
    const request = await requestRole(applicantRejected, {
      volunteerAccessRequested: true,
      volunteerAccessGranted: true,
      status: 'approved',
    })
    expect(request.status).toBe('pending')
    expect(request.volunteerAccessGranted).toBe(false)
    await expect(decide(request.id, { status: 'approved', volunteerAccessGranted: true }, applicantRejected)).rejects.toThrow()

    await decide(request.id, { status: 'rejected' })
    expect(await organizerRole(applicantRejected)).toBeUndefined()
  })

  it('the obec approves both — the role comes with the pool', async () => {
    const request = await requestRole(applicantAll, { volunteerAccessRequested: true })
    const decided = await decide(request.id, { status: 'approved', volunteerAccessGranted: true })
    expect(decided.volunteerAccessGranted).toBe(true)
    expect((await organizerRole(applicantAll)).volunteerAccess).toBe(true)
  })

  it('the obec approves the role alone — no pool', async () => {
    const request = await requestRole(applicantRole, { volunteerAccessRequested: true })
    await decide(request.id, { status: 'approved' })
    const role = await organizerRole(applicantRole)
    expect(role).toBeTruthy()
    expect(role.volunteerAccess).toBe(false)
  })

  it('the pool can’t be granted to someone who didn’t ask for it, nor after the decision', async () => {
    const request = await requestRole(applicantNoPool)
    await expect(decide(request.id, { status: 'approved', volunteerAccessGranted: true })).rejects.toThrow(/nežádal/)
    await decide(request.id, { status: 'approved' })
    await expect(decide(request.id, { volunteerAccessGranted: true })).rejects.toThrow()
    expect((await organizerRole(applicantNoPool)).volunteerAccess).toBe(false)
  })

  it('without access an organizer neither marks an event as volunteering nor invites from the pool', async () => {
    const event = await createEvent(withoutAccess)
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { isVolunteering: true }, user: withoutAccess, overrideAccess: false }),
    ).rejects.toThrow(/přístupem k poolu/)
    await expect(
      payload.create({
        collection: 'volunteer-invitations',
        data: { event: event.id, volunteer: volunteer.id } as never,
        user: withoutAccess,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/přístupem k poolu/)

    const allowed = await createEvent(withAccess)
    const updated = await payload.update({
      collection: 'events',
      id: allowed.id,
      data: { isVolunteering: true },
      user: withAccess,
      overrideAccess: false,
    })
    expect(updated.isVolunteering).toBe(true)
    const invitation = await payload.create({
      collection: 'volunteer-invitations',
      data: { event: allowed.id, volunteer: volunteer.id } as never,
      user: withAccess,
      overrideAccess: false,
    })
    expect(invitation.status).toBe('pending')
  })

  it('an organizer asks for the pool alone — the obec approves it, and it can take it away again; sent invitations stay', async () => {
    // Not by someone who doesn't organize here.
    await expect(
      payload.create({
        collection: 'organizer-requests',
        data: { user: volunteer.id, municipality: municipality.id, kind: 'volunteer_access' } as never,
        user: volunteer,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    const request = await payload.create({
      collection: 'organizer-requests',
      data: { user: withoutAccess.id, municipality: municipality.id, kind: 'volunteer_access' } as never,
      user: withoutAccess,
      overrideAccess: false,
    })
    expect(request.kind).toBe('volunteer_access')
    await decide(request.id, { status: 'approved' })
    const role = await organizerRole(withoutAccess)
    expect(role.volunteerAccess).toBe(true)

    // Already has it — nothing more to ask for.
    await expect(
      payload.create({
        collection: 'organizer-requests',
        data: { user: withoutAccess.id, municipality: municipality.id, kind: 'volunteer_access' } as never,
        user: withoutAccess,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    const event = await createEvent(withoutAccess)
    const invitation = await payload.create({
      collection: 'volunteer-invitations',
      data: { event: event.id, volunteer: volunteer.id } as never,
      user: withoutAccess,
      overrideAccess: false,
    })

    const response = await setAccessRoute(
      await authed(obecAdmin, `http://localhost/api/user-roles/${role.id}/volunteer-access`, {
        method: 'POST',
        body: JSON.stringify({ volunteerAccess: false }),
      }),
      { params: Promise.resolve({ id: String(role.id) }) },
    )
    expect(response.status).toBe(200)
    expect((await organizerRole(withoutAccess)).volunteerAccess).toBe(false)
    const kept = await payload.findByID({ collection: 'volunteer-invitations', id: invitation.id, overrideAccess: true })
    expect(kept.status).toBe('pending')
    expect((await listPool(await authed(withoutAccess, 'http://localhost/api/admin/volunteers'))).status).toBe(403)
  })
})
