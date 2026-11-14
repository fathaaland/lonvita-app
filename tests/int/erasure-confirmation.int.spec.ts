// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
}))

import { DELETE as withdrawRoute, POST as confirmRoute } from '@/app/api/superadmin/billing/[id]/erasure/route'
import { TERMINATED_DAYS, erasureConfirmed } from '@/lib/billing/status'
import { advanceBillingStatuses } from '@/lib/billing/status-step'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

/**
 * Erasing an obec for good needs the platform's own go-ahead, typed by hand: the clock alone never does
 * it, no obec admin nor ordinary user can give it, no generic update (not even a platform admin's) can
 * write it, and it holds only for the terminated stage it was given for.
 */
describe('Erasure confirmation — only the superadmin, only by hand', () => {
  let platform: TestUser
  let otherAdmin: TestUser
  let resident: TestUser
  const userIds: number[] = []
  const obecIds: number[] = []

  const as = (u: TestUser) => ({ user: { ...u, collection: 'users' as const }, overrideAccess: false as const })
  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `erasure-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  const makeObec = async (label: string, admin?: TestUser) => {
    const obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Erasure ${label} ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })
    obecIds.push(obec.id)
    if (admin) {
      await payload.create({ collection: 'user-roles', data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
    }
    return obec
  }
  /** terminated, its period ran out — due for erasure the next night. */
  const makeDue = async (label: string, admin?: TestUser) => {
    const obec = await makeObec(label, admin)
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'terminated' }, overrideAccess: true })
    await age(obec.id)
    return obec
  }
  const age = (id: number) =>
    payload.update({
      collection: 'municipalities',
      id,
      data: { billingStatusChangedAt: new Date(Date.now() - (TERMINATED_DAYS + 1) * DAY).toISOString() },
      overrideAccess: true,
    })
  const read = (id: number) => payload.findByID({ collection: 'municipalities', id, depth: 0, overrideAccess: true }).catch(() => null)
  const tokenOf = async (u: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: u.email, password: 'test1234' } })).token as string
  const call = async (handler: typeof confirmRoute, u: TestUser | null, id: number | string, body?: unknown): Promise<Response> =>
    (await handler(
      new Request(`http://localhost/api/superadmin/billing/${id}/erasure`, {
        method: handler === confirmRoute ? 'POST' : 'DELETE',
        headers: { ...(u ? { Authorization: `JWT ${await tokenOf(u)}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: String(id) }) },
    )) as Response

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    platform = await makeUser('root', 'admin')
    otherAdmin = await makeUser('other-admin')
    resident = await makeUser('resident')
  }, 120_000)

  afterAll(async () => {
    for (const id of obecIds) await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  it('an obec past its period that nobody confirmed is not erased — however long it waits', async () => {
    const obec = await makeDue('waits', await makeUser('waits-admin'))
    const result = await advanceBillingStatuses(payload)
    expect(result.awaitingConfirmation).toBeGreaterThanOrEqual(1)
    expect(await read(obec.id)).not.toBeNull()
    // The next night too — the clock never turns into consent.
    await advanceBillingStatuses(payload)
    expect(await read(obec.id)).not.toBeNull()
    expect((await read(obec.id))?.billingStatus).toBe('terminated')
  })

  it('the superadmin confirms by typing the exact name — then the next night erases it', async () => {
    const obec = await makeDue('confirmed')
    const wrong = await call(confirmRoute, platform, obec.id, { confirmName: 'jiná obec' })
    expect(wrong.status).toBe(400)
    expect((await call(confirmRoute, platform, obec.id, {})).status).toBe(400)
    expect(await read(obec.id)).toMatchObject({ erasureConfirmedStage: null })
    await advanceBillingStatuses(payload)
    expect(await read(obec.id)).not.toBeNull()

    const ok = await call(confirmRoute, platform, obec.id, { confirmName: obec.name })
    expect(ok.status).toBe(200)
    // On the record: who confirmed it, and what.
    await vi.waitFor(async () => {
      const entries = await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: 'municipalities.erasure-confirm' } }, { targetId: { equals: String(obec.id) } }] },
        overrideAccess: true,
      })
      expect(entries.docs).toHaveLength(1)
    })

    expect((await advanceBillingStatuses(payload)).erased).toBeGreaterThanOrEqual(1)
    expect(await read(obec.id)).toBeNull()
  })

  it('can be withdrawn — then the obec stays', async () => {
    const obec = await makeDue('withdrawn')
    await call(confirmRoute, platform, obec.id, { confirmName: obec.name })
    expect(erasureConfirmed('terminated', (await read(obec.id))!.billingStatusChangedAt, (await read(obec.id))!.erasureConfirmedStage)).toBe(true)
    expect((await call(withdrawRoute, platform, obec.id)).status).toBe(200)
    await advanceBillingStatuses(payload)
    expect(await read(obec.id)).not.toBeNull()
  })

  it('only an obec that is terminated can be confirmed', async () => {
    for (const status of ['active', 'suspended', 'read_only']) {
      const obec = await makeObec(`not-${status}`)
      if (status !== 'active') await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: status } as never, overrideAccess: true })
      expect((await call(confirmRoute, platform, obec.id, { confirmName: obec.name })).status).toBe(409)
      expect((await read(obec.id))?.erasureConfirmedStage ?? null).toBeNull()
    }
    expect((await call(confirmRoute, platform, 987654321, { confirmName: 'x' })).status).toBe(404)
    expect((await call(confirmRoute, platform, 'abc', { confirmName: 'x' })).status).toBe(400)
  })

  it('nobody but a platform admin can confirm or withdraw: not the obec itself, not another obec, not a resident, not signed out', async () => {
    const targetAdmin = await makeUser('target-admin')
    const obec = await makeDue('target', targetAdmin)
    await makeObec('foreign', otherAdmin)
    for (const who of [targetAdmin, otherAdmin, resident, null]) {
      expect((await call(confirmRoute, who, obec.id, { confirmName: obec.name })).status).toBe(403)
      expect((await call(withdrawRoute, who, obec.id)).status).toBe(403)
    }
    expect((await read(obec.id))?.erasureConfirmedStage ?? null).toBeNull()
    await advanceBillingStatuses(payload)
    expect(await read(obec.id)).not.toBeNull()
  })

  it('no generic update writes the confirmation — not the obec admin, not a platform admin, not in bulk', async () => {
    const forgedAdmin = await makeUser('forged-admin')
    const obec = await makeDue('forged', forgedAdmin)
    const stage = (await read(obec.id))!.billingStatusChangedAt!
    const forged = { erasureConfirmedStage: stage, billingStatus: 'terminated' } as never
    for (const attacker of [forgedAdmin, otherAdmin, resident, platform]) {
      await payload.update({ collection: 'municipalities', id: obec.id, data: forged, ...as(attacker) }).catch(() => null)
      await payload
        .update({ collection: 'municipalities', where: { id: { exists: true } }, data: forged, ...as(attacker) })
        .catch(() => null)
    }
    expect((await read(obec.id))?.erasureConfirmedStage ?? null).toBeNull()
    // Nor can the field be read by anyone but the platform.
    await call(confirmRoute, platform, obec.id, { confirmName: obec.name })
    const asAdmin = await payload.findByID({ collection: 'municipalities', id: obec.id, ...as(forgedAdmin) })
    expect((asAdmin as { erasureConfirmedStage?: unknown }).erasureConfirmedStage).toBeUndefined()
    // …and there's still no way for the obec admin to clear it either.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { erasureConfirmedStage: null } as never, ...as(forgedAdmin) }).catch(() => null)
    expect((await read(obec.id))?.erasureConfirmedStage).toBeTruthy()
  })

  it('a confirmation holds for its stage alone — back to active and terminated again, or the clock moved, and it is gone', async () => {
    const obec = await makeDue('stale')
    await call(confirmRoute, platform, obec.id, { confirmName: obec.name })
    const confirmed = (await read(obec.id))!.erasureConfirmedStage!

    // Paid, set active — then terminated again (a new stage), its clock aged past the period.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'active' }, ...as(platform) })
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'terminated' }, ...as(platform) })
    await age(obec.id)
    expect((await read(obec.id))?.erasureConfirmedStage).toBeTruthy() // the old value is still stored…
    await advanceBillingStatuses(payload)
    expect(await read(obec.id)).not.toBeNull() // …and counts for nothing.

    // Even an aged clock that lands on the old value's side doesn't revive it — only an exact stage match does.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatusChangedAt: new Date(Date.parse(confirmed) - DAY).toISOString() }, overrideAccess: true })
    await advanceBillingStatuses(payload)
    expect(await read(obec.id)).not.toBeNull()

    expect(erasureConfirmed('terminated', confirmed, confirmed)).toBe(true)
    expect(erasureConfirmed('terminated', new Date(Date.parse(confirmed) + 1).toISOString(), confirmed)).toBe(false)
    expect(erasureConfirmed('read_only', confirmed, confirmed)).toBe(false)
    expect(erasureConfirmed('terminated', null, confirmed)).toBe(false)
    expect(erasureConfirmed('terminated', confirmed, null)).toBe(false)
  })
})
