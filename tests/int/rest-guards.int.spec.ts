// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEventUpdated: vi.fn(async () => undefined),
}))

import { DELETE, GET, PATCH } from '@/app/(payload)/api/[...slug]/route'

let payload: Payload
const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

/**
 * The guards of collections written as `beforeOperation` hooks (the last admin of an obec, a
 * registrant approving themselves, a role set through the account, the audit log's own record of
 * being read) must hold for the real HTTP API. Over REST Payload leaves `overrideAccess` undefined —
 * "enforce" — so a guard that only steps aside for an explicit `true` holds, while one that stepped
 * aside for anything but `false` was skipped. The Local API with `overrideAccess: false` (what most
 * tests use) never showed the difference.
 */
describe('Guards hold over REST, not only through the Local API', () => {
  let platform: TestUser
  let soleAdmin: TestUser
  let participant: TestUser
  let obec: { id: number }
  let category: { id: number }
  const userIds: number[] = []

  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `restguard-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  const tokenOf = async (u: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: u.email, password: 'test1234' } })).token as string
  const call = async (handler: typeof GET, method: string, path: string, token: string, body?: unknown) => {
    const response = await handler(
      new Request(`http://localhost/api/${path}`, {
        method,
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug: path.split('?')[0].split('/') }) },
    )
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> }
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    platform = await makeUser('root', 'admin')
    soleAdmin = await makeUser('admin')
    participant = await makeUser('participant')
    obec = await payload.create({
      collection: 'municipalities',
      data: { name: `RestGuard ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' } as never,
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `RestGuard ${STAMP}` }, overrideAccess: true })
    await payload.create({ collection: 'user-roles', data: { user: soleAdmin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
  }, 120_000)

  afterAll(async () => {
    await payload.delete({ collection: 'registrations', where: { user: { equals: participant.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { municipality: { equals: obec.id } }, overrideAccess: true, context: { deletingMunicipality: true } }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  it("an obec's last admin can't take their own role away", async () => {
    const role = await payload.find({
      collection: 'user-roles',
      where: { and: [{ user: { equals: soleAdmin.id } }, { municipality: { equals: obec.id } }] },
      depth: 0,
      overrideAccess: true,
    })
    const res = await call(DELETE, 'DELETE', `user-roles/${role.docs[0].id}`, await tokenOf(soleAdmin))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(
      (await payload.count({ collection: 'user-roles', where: { municipality: { equals: obec.id } }, overrideAccess: true })).totalDocs,
    ).toBe(1)
  })

  it('nobody sets the platform role on an account over REST', async () => {
    const res = await call(PATCH, 'PATCH', `users/${participant.id}`, await tokenOf(participant), { role: 'admin' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect((await payload.findByID({ collection: 'users', id: participant.id, depth: 0, overrideAccess: true })).role).toBe('user')
  })

  it('a registrant approves nobody, themselves least — one by one or in bulk', async () => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Guard ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        locationText: 'Sál',
        lat: 49.4,
        lng: 15.2,
        capacity: 1,
        organizer: soleAdmin.id,
        municipality: obec.id,
        categories: [category.id],
        status: 'active',
        registrationApprovalMode: 'manual',
      } as never,
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    const registration = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'pending' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    const token = await tokenOf(participant)
    const statusOf = async () => (await payload.findByID({ collection: 'registrations', id: registration.id, depth: 0, overrideAccess: true })).status

    const single = await call(PATCH, 'PATCH', `registrations/${registration.id}`, token, { status: 'approved' })
    expect(single.status).toBeGreaterThanOrEqual(400)
    expect(await statusOf()).toBe('pending')

    const bulk = await call(PATCH, 'PATCH', `registrations?where[id][equals]=${registration.id}`, token, { status: 'approved' })
    expect(bulk.status).toBeGreaterThanOrEqual(400)
    expect(await statusOf()).toBe('pending')
  })

  it('looking into the audit log is itself on the record, over REST too', async () => {
    const before = await payload.count({ collection: 'audit-log', where: { action: { equals: 'audit-log.read' } }, overrideAccess: true })
    const res = await call(GET, 'GET', 'audit-log?limit=1', await tokenOf(platform))
    expect(res.status).toBe(200)
    const after = await payload.count({ collection: 'audit-log', where: { action: { equals: 'audit-log.read' } }, overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs + 1)
  })
})
