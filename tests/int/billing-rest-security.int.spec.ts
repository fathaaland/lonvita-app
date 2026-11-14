// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

import { DELETE, GET, PATCH, POST } from '@/app/(payload)/api/[...slug]/route'

let payload: Payload
const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

/**
 * What an obec (or anyone) can do to its own billing through the real HTTP API — Payload's REST handler,
 * with the JWT every browser or script would send; not the Local API, which skips access control unless
 * told otherwise. The price list (cap on SMS overage, prices) and every obec's billing fields are the
 * platform's alone, and nobody can make themselves the platform.
 */
describe('Billing over REST — an obec cannot raise its own SMS cap, quota or package', () => {
  let platform: TestUser
  let obecAdmin: TestUser
  let otherAdmin: TestUser
  let resident: TestUser
  let demoted: TestUser
  let obec: { id: number }
  const userIds: number[] = []
  const obecIds: number[] = []

  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `restsec-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  const tokenOf = async (u: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: u.email, password: 'test1234' } })).token as string

  /** A request as Payload's REST route receives it: `/api/<path>` with the bearer token, if any. */
  const call = async (
    handler: typeof GET,
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await handler(
      new Request(`http://localhost/api/${path}`, {
        method,
        headers: { ...(token ? { Authorization: `JWT ${token}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug: path.split('/') }) },
    )
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const catalog = () => payload.findGlobal({ slug: 'billing-settings', depth: 0, overrideAccess: true })
  const stored = () => payload.findByID({ collection: 'municipalities', id: obec.id, depth: 0, overrideAccess: true })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    platform = await makeUser('root', 'admin')
    obecAdmin = await makeUser('admin')
    otherAdmin = await makeUser('other-admin')
    resident = await makeUser('resident')
    demoted = await makeUser('demoted', 'admin')
    await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 50 }, overrideAccess: true })
    obec = await payload.create({
      collection: 'municipalities',
      data: {
        name: `RestSec ${STAMP}`,
        lat: 49.4,
        lng: 15.2,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
        smsEnabled: true,
        smsQuotaOverride: 10,
        licencePaidUntil: new Date(Date.now() + 200 * 86_400_000).toISOString(),
      },
      overrideAccess: true,
    })
    obecIds.push(obec.id)
    await payload.create({ collection: 'user-roles', data: { user: obecAdmin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
    const other = await payload.create({
      collection: 'municipalities',
      data: { name: `RestSec other ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })
    obecIds.push(other.id)
    await payload.create({ collection: 'user-roles', data: { user: otherAdmin.id, municipality: other.id, role: 'municipality_admin' }, overrideAccess: true })
  }, 120_000)

  afterAll(async () => {
    await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 50 }, overrideAccess: true }).catch(() => {})
    for (const id of obecIds) await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  it('the price list (with the overage cap) cannot be read or written by an obec admin, another obec admin, a resident, or nobody', async () => {
    for (const who of [obecAdmin, otherAdmin, resident, null]) {
      const token = who ? await tokenOf(who) : null
      expect((await call(GET, 'GET', 'globals/billing-settings', token)).status).toBe(403)
      for (const method of ['POST', 'PATCH', 'PUT'] as const) {
        const handler = method === 'PATCH' ? PATCH : POST
        const res = await call(handler, method, 'globals/billing-settings', token, { smsOverageCapPercent: 200 })
        expect(res.status, `${method} as ${who?.email ?? 'nobody'}`).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
      }
    }
    expect((await catalog()).smsOverageCapPercent).toBe(50)
  })

  it("an obec admin's own PATCH of its obec changes nothing billing-related — quota, package, cap-relevant switches, status, dates", async () => {
    const token = await tokenOf(obecAdmin)
    const forged = {
      description: 'the one thing it may change',
      smsQuotaOverride: 100000,
      smsPackage: 'l',
      smsEnabled: false,
      importAiEnabled: true,
      billingStatus: 'terminated',
      billingStatusChangedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      licencePaidUntil: new Date(Date.now() + 3650 * 86_400_000).toISOString(),
      licenceTier: 0,
      licenceCustomYearlyCzk: 1,
      smsAlertState: 'x|0',
      erasureConfirmedStage: new Date().toISOString(),
    }
    const before = await stored()
    const res = await call(PATCH, 'PATCH', `municipalities/${obec.id}`, token, forged)
    expect(res.status).toBeLessThan(500)
    const after = await stored()
    expect(after.description).toBe('the one thing it may change')
    for (const field of Object.keys(forged).filter((k) => k !== 'description') as (keyof typeof after)[]) {
      expect(after[field] ?? null, String(field)).toEqual(before[field] ?? null)
    }
    // Bulk too — every obec at once.
    const bulk = await call(PATCH, 'PATCH', 'municipalities?where[id][exists]=true', token, { smsQuotaOverride: 100000 })
    expect(bulk.status).toBeLessThan(500)
    expect((await stored()).smsQuotaOverride).toBe(10)
    expect((await payload.count({ collection: 'municipalities', where: { smsQuotaOverride: { equals: 100000 } }, overrideAccess: true })).totalDocs).toBe(0)
  })

  it('an obec admin of another obec cannot touch this one at all', async () => {
    const token = await tokenOf(otherAdmin)
    const res = await call(PATCH, 'PATCH', `municipalities/${obec.id}`, token, { smsQuotaOverride: 100000, description: 'x' })
    expect(res.status).toBeLessThan(500)
    const after = await stored()
    expect(after.smsQuotaOverride).toBe(10)
    expect(after.description).not.toBe('x')
  })

  it('nobody makes themselves the platform: the role cannot be set over REST, nor an account created with it', async () => {
    const token = await tokenOf(obecAdmin)
    await call(PATCH, 'PATCH', `users/${obecAdmin.id}`, token, { role: 'admin' })
    expect((await payload.findByID({ collection: 'users', id: obecAdmin.id, depth: 0, overrideAccess: true })).role).toBe('user')
    const created = await call(POST, 'POST', 'users', token, { email: `restsec-new-${STAMP}@test.local`, password: 'test1234', role: 'admin' })
    expect(created.status).toBeGreaterThanOrEqual(400)
    expect((await payload.count({ collection: 'users', where: { email: { equals: `restsec-new-${STAMP}@test.local` } }, overrideAccess: true })).totalDocs).toBe(0)
    // Still no way to the price list.
    expect((await call(POST, 'POST', 'globals/billing-settings', token, { smsOverageCapPercent: 200 })).status).toBeGreaterThanOrEqual(400)
    expect((await catalog()).smsOverageCapPercent).toBe(50)
  })

  it("a platform admin's old token stops working as one the moment the role is gone — the role is read from the database, not the token", async () => {
    const token = await tokenOf(demoted)
    // Works while the role holds…
    expect((await call(GET, 'GET', 'globals/billing-settings', token)).status).toBe(200)
    await payload.update({ collection: 'users', id: demoted.id, data: { role: 'user' }, overrideAccess: true })
    // …and not a request after it's taken away, though the token still says "admin".
    expect((await call(GET, 'GET', 'globals/billing-settings', token)).status).toBe(403)
    expect((await call(POST, 'POST', 'globals/billing-settings', token, { smsOverageCapPercent: 200 })).status).toBeGreaterThanOrEqual(400)
    expect((await catalog()).smsOverageCapPercent).toBe(50)
  })

  it('the platform may set the cap — within 0–200 % — and nobody else', async () => {
    const token = await tokenOf(platform)
    expect((await call(POST, 'POST', 'globals/billing-settings', token, { smsOverageCapPercent: 500 })).status).toBeGreaterThanOrEqual(400)
    expect((await call(POST, 'POST', 'globals/billing-settings', token, { smsOverageCapPercent: -5 })).status).toBeGreaterThanOrEqual(400)
    expect((await catalog()).smsOverageCapPercent).toBe(50)
    expect((await call(POST, 'POST', 'globals/billing-settings', token, { smsOverageCapPercent: 100 })).status).toBe(200)
    expect((await catalog()).smsOverageCapPercent).toBe(100)
    // The change is on the record, with who made it.
    await vi.waitFor(async () => {
      const entries = await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: 'billing-settings.update' } }, { actor: { equals: platform.id } }] },
        sort: '-createdAt',
        limit: 1,
        overrideAccess: true,
      })
      expect(entries.docs[0]?.metadata).toMatchObject({ after: { smsOverageCapPercent: 100 } })
    })
    await call(POST, 'POST', 'globals/billing-settings', token, { smsOverageCapPercent: 50 })
    expect((await catalog()).smsOverageCapPercent).toBe(50)
  })

  it('there is no GraphQL to try it through, and nothing deletes the price list or an obec for a non-platform user', async () => {
    const token = await tokenOf(obecAdmin)
    expect([404, 405]).toContain((await call(POST, 'POST', 'graphql', token, { query: 'mutation { updateBillingSettings(data: {smsOverageCapPercent: 200}) { id } }' })).status)
    expect((await call(DELETE, 'DELETE', `municipalities/${obec.id}`, token)).status).toBeGreaterThanOrEqual(400)
    expect((await call(DELETE, 'DELETE', 'municipalities?where[id][exists]=true', token)).status).toBeLessThan(500)
    expect((await stored()).id).toBe(obec.id)
    expect((await catalog()).smsOverageCapPercent).toBe(50)
  })
})
