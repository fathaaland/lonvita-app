// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as runningEvents } from '@/app/api/user-roles/[id]/running-events/route'

let payload: Payload

type TestUser = { id: number; email: string; role: string }

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

let obec: { id: number }
let category: { id: number }
let admin: TestUser
let organizer: TestUser
let other: TestUser
let roleId: number
let runsEventId: number
let coOrganizesEventId: number
const eventIds: number[] = []

const createUser = (name: string) =>
  payload.create({
    collection: 'users',
    data: { email: `running-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  }) as Promise<TestUser>

const createEvent = async (title: string, by: TestUser, coOrganizations: number[] = []) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `${title} ${STAMP}`,
      dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
      locationText: 'Náves',
      lat: 49.5,
      lng: 15.9,
      capacity: 10,
      organizer: by.id,
      municipality: obec.id,
      categories: [category.id],
      status: 'active',
      isPaid: false,
      registrationApprovalMode: 'auto',
      coOrganizations,
    },
    context: { skipNotifications: true, coOrganizingApproved: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event.id
}

const cancel = (id: number) =>
  payload.update({
    collection: 'events',
    id,
    data: { status: 'cancelled' },
    context: { skipNotifications: true },
    overrideAccess: true,
  })

const revoke = () => payload.delete({ collection: 'user-roles', id: roleId, user: admin, overrideAccess: false })
const roleExists = async () =>
  (await payload.count({ collection: 'user-roles', where: { id: { equals: roleId } }, overrideAccess: true })).totalDocs === 1

const listAs = async (user: TestUser) => {
  const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
  return runningEvents(
    new Request(`http://localhost/api/user-roles/${roleId}/running-events`, { headers: { Authorization: `JWT ${token}` } }),
    { params: Promise.resolve({ id: String(roleId) }) },
  )
}

describe("An organizer's role can't be revoked while they run events in the obec", () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Running ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5, lng: 15.9, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Running Category ${STAMP}` },
      overrideAccess: true,
    })
    admin = await createUser('admin')
    organizer = await createUser('organizer')
    other = await createUser('other')
    await payload.create({
      collection: 'user-roles',
      data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    roleId = (
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: obec.id, role: 'organizer' },
        overrideAccess: true,
      })
    ).id
    await payload.create({
      collection: 'user-roles',
      data: { user: other.id, municipality: obec.id, role: 'organizer' },
      overrideAccess: true,
    })
    const organization = (
      await payload.find({
        collection: 'organizations',
        where: { owner: { equals: organizer.id } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]

    runsEventId = await createEvent('Turnaj', organizer)
    coOrganizesEventId = await createEvent('Vycházka', other, [organization.id])
  })

  afterAll(async () => {
    const userIds = [admin.id, organizer.id, other.id]
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: obec.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it('lists the events they run and co-organize — for the obec admin only', async () => {
    const res = await listAs(admin)
    expect(res.status).toBe(200)
    const { events } = (await res.json()) as { events: { id: string; organizes: string }[] }
    expect(events.map((e) => [Number(e.id), e.organizes]).sort()).toEqual(
      [
        [runsEventId, 'runs'],
        [coOrganizesEventId, 'co-organizes'],
      ].sort(),
    )
    expect((await listAs(other)).status).toBe(403)
  })

  it('refuses the revoke while any event is running — run or co-organized', async () => {
    await expect(revoke()).rejects.toThrow(/rozjeté akce/)
    await cancel(runsEventId)
    await expect(revoke()).rejects.toThrow(/rozjetou akci/)
    expect(await roleExists()).toBe(true)

    // Nothing was moved off the events meanwhile.
    const coOrganized = await payload.findByID({ collection: 'events', id: coOrganizesEventId, depth: 0, overrideAccess: true })
    expect((coOrganized.coOrganizers ?? []).map((u) => (typeof u === 'object' ? u.id : u))).toContain(organizer.id)
  })

  it('lets it go once nothing is running', async () => {
    await cancel(coOrganizesEventId)
    const res = await listAs(admin)
    expect(((await res.json()) as { events: unknown[] }).events).toEqual([])
    await revoke()
    expect(await roleExists()).toBe(false)
  })
})
