// @vitest-environment node
import { getPayload, Payload, type Where } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueImportEvents: vi.fn(async () => undefined),
}))

import { TERMINATED_DAYS } from '@/lib/billing/status'
import { advanceBillingStatuses, eraseObecLeftovers } from '@/lib/billing/status-step'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }
type Obec = { id: number; name: string }

/**
 * One obec can never take another's data with it. The attacker is the admin of obec B, using every
 * door Payload gives a signed-in user (overrideAccess: false — what REST does) on obec A; and the
 * contract-end erasure of obec C — the one thing in the app that deletes an obec — touches only C.
 */
describe('Obce are isolated — nobody deletes or turns off another obec', () => {
  let category: { id: number }
  let victim: Obec // A
  let attacker: Obec // B
  let doomed: Obec // C — its contract ended
  let victimAdmin: TestUser
  let attackerAdmin: TestUser
  let doomedAdmin: TestUser
  let resident: TestUser
  const userIds: number[] = []
  const obecIds: number[] = []
  let regionId: number

  const as = (u: TestUser) => ({ user: { ...u, collection: 'users' as const }, overrideAccess: false as const })
  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `isolation-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    await payload.create({ collection: 'profiles', data: { user: u.id, fullName: `Isolation ${name}` } as never, overrideAccess: true })
    return u
  }
  const makeObec = async (label: string): Promise<{ obec: Obec; admin: TestUser }> => {
    const obec = (await payload.create({
      collection: 'municipalities',
      data: { name: `Isolation ${label} ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })) as Obec
    obecIds.push(obec.id)
    const admin = await makeUser(`admin-${label}`)
    await payload.create({
      collection: 'user-roles',
      data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    return { obec, admin }
  }
  const obecOrgOf = async (obec: Obec) =>
    (
      await payload.find({
        collection: 'organizations',
        where: { and: [{ municipality: { equals: obec.id } }, { type: { equals: 'municipality' } }] },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]!.id
  const makeEvent = (obec: Obec, organizer: TestUser, startsIn: number) =>
    payload.create({
      collection: 'events',
      data: {
        title: `Isolation event ${obec.id} ${STAMP}`,
        dateTime: new Date(Date.now() + startsIn).toISOString(),
        locationText: 'Náves',
        lat: 49.4,
        lng: 15.2,
        capacity: 10,
        organizer: organizer.id,
        municipality: obec.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
  /** The platform's confirmation of the stage the obec is in now (what POST …/erasure stores). */
  const confirm = async (o: Obec) => {
    const stored = await payload.findByID({ collection: 'municipalities', id: o.id, depth: 0, overrideAccess: true })
    await payload.update({ collection: 'municipalities', id: o.id, data: { erasureConfirmedStage: stored.billingStatusChangedAt }, overrideAccess: true })
  }
  const count = async (collection: string, where: Where) =>
    (await payload.count({ collection: collection as 'events', where, overrideAccess: true })).totalDocs

  /** What obec `o` owns, counted — compared before and after an attack. */
  const inventory = async (o: Obec) => ({
    obec: await count('municipalities', { id: { equals: o.id } }),
    events: await count('events', { municipality: { equals: o.id } }),
    registrations: await count('registrations', { 'event.municipality': { equals: o.id } }),
    roles: await count('user-roles', { municipality: { equals: o.id } }),
    organizations: await count('organizations', { municipality: { equals: o.id } }),
    sources: await count('event-sources', { municipality: { equals: o.id } }),
    sms: await count('sms-messages', { municipality: { equals: o.id } }),
  })

  let victimEvent: { id: number }
  let victimBefore: Awaited<ReturnType<typeof inventory>>
  let attackerBefore: Awaited<ReturnType<typeof inventory>>

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    category = await payload.create({ collection: 'event-categories', data: { name: `Isolation category ${STAMP}` }, overrideAccess: true })
    resident = await makeUser('resident')
    ;({ obec: victim, admin: victimAdmin } = await makeObec('victim'))
    ;({ obec: attacker, admin: attackerAdmin } = await makeObec('attacker'))
    ;({ obec: doomed, admin: doomedAdmin } = await makeObec('doomed'))

    victimEvent = await makeEvent(victim, victimAdmin, 5 * DAY)
    const attackerEvent = await makeEvent(attacker, attackerAdmin, 5 * DAY)
    for (const [event, user] of [
      [victimEvent, victimAdmin],
      [attackerEvent, attackerAdmin],
    ] as const) {
      await payload.db.create({
        collection: 'registrations',
        data: { event: event.id, user: user.id, status: 'approved', role: 'participant', attendanceStatus: 'not_marked' },
      })
    }
    for (const o of [victim, attacker]) {
      await payload.create({ collection: 'event-sources', data: { municipality: o.id, url: `https://example.org/${o.id}-${STAMP}` } as never, overrideAccess: true })
      await payload.create({ collection: 'sms-messages', data: { municipality: o.id, parts: 1 }, overrideAccess: true })
    }
    regionId = (
      await payload.create({
        collection: 'microregions',
        data: { name: `Isolation region ${STAMP}`, municipalities: [victim.id, attacker.id, doomed.id], mainMunicipality: victim.id },
        overrideAccess: true,
      })
    ).id
    // The victim's event is co-organized by the doomed obec — they sit in one microregion.
    await payload.update({
      collection: 'events',
      id: victimEvent.id,
      data: { coOrganizations: [await obecOrgOf(doomed)] },
      context: { coOrganizingApproved: true, skipNotifications: true },
      overrideAccess: true,
    })
    victimBefore = await inventory(victim)
    attackerBefore = await inventory(attacker)
  }, 180_000)

  afterAll(async () => {
    const quietly = (p: Promise<unknown>) => p.catch(() => {})
    await quietly(payload.delete({ collection: 'microregions', id: regionId, overrideAccess: true }))
    for (const id of obecIds) {
      await quietly(payload.delete({ collection: 'events', where: { municipality: { equals: id } }, overrideAccess: true }))
      await quietly(payload.delete({ collection: 'sms-messages', where: { municipality: { equals: id } }, overrideAccess: true }))
      await quietly(payload.delete({ collection: 'municipalities', id, overrideAccess: true }))
    }
    await quietly(payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }))
    await quietly(payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quietly(payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }))
    for (const id of userIds) await quietly(payload.delete({ collection: 'users', id, overrideAccess: true }))
  })

  it("the attacker's admin cannot delete an obec — neither the victim's, nor its own, nor any in bulk", async () => {
    await expect(payload.delete({ collection: 'municipalities', id: victim.id, ...as(attackerAdmin) })).rejects.toThrow()
    await expect(payload.delete({ collection: 'municipalities', id: attacker.id, ...as(attackerAdmin) })).rejects.toThrow()
    const bulk = await payload.delete({ collection: 'municipalities', where: { id: { exists: true } }, ...as(attackerAdmin) }).catch(() => null)
    expect(bulk?.docs ?? []).toHaveLength(0)
    // Nor can an ordinary resident, nor the obec's own admin.
    await expect(payload.delete({ collection: 'municipalities', id: victim.id, ...as(resident) })).rejects.toThrow()
    await expect(payload.delete({ collection: 'municipalities', id: victim.id, ...as(victimAdmin) })).rejects.toThrow()
    expect(await inventory(victim)).toEqual(victimBefore)
    expect(await inventory(attacker)).toEqual(attackerBefore)
  })

  it("the attacker's admin cannot delete the victim's events, registrations, roles, sources or organizations", async () => {
    const attempts: [string, Where][] = [
      ['events', { municipality: { equals: victim.id } }],
      ['registrations', { 'event.municipality': { equals: victim.id } }],
      ['user-roles', { municipality: { equals: victim.id } }],
      ['event-sources', { municipality: { equals: victim.id } }],
      ['organizations', { municipality: { equals: victim.id } }],
      ['sms-messages', { municipality: { equals: victim.id } }],
      ['usage-events', { municipality: { equals: victim.id } }],
      ['audit-log', {}],
      // A where-less wildcard — the widest thing a request can say.
      ['events', { id: { exists: true } }],
      ['registrations', { id: { exists: true } }],
      ['user-roles', { id: { exists: true } }],
      ['event-sources', { id: { exists: true } }],
    ]
    for (const [collection, where] of attempts) {
      await payload.delete({ collection: collection as 'events', where, ...as(attackerAdmin) }).catch(() => null)
    }
    await payload.delete({ collection: 'events', id: victimEvent.id, ...as(attackerAdmin) }).catch(() => null)
    expect(await inventory(victim)).toEqual(victimBefore)
    // An obec admin may clear out their own obec's registrations and sources — the wildcard above took
    // exactly those, and nothing of the victim's. Never what only the platform may delete.
    const attackerAfter = await inventory(attacker)
    expect(attackerAfter.obec).toBe(1)
    expect(attackerAfter.organizations).toBe(attackerBefore.organizations)
    expect(attackerAfter.sms).toBe(attackerBefore.sms)
    expect(attackerAfter.registrations).toBeLessThanOrEqual(attackerBefore.registrations)
    attackerBefore = attackerAfter
  })

  it("the attacker's admin cannot change the victim's billing — nor its own, nor in bulk — to switch it off or on", async () => {
    const attempts = [
      { id: victim.id, data: { billingStatus: 'terminated' } },
      { id: victim.id, data: { billingStatus: 'suspended', billingStatusChangedAt: new Date(Date.now() - 400 * DAY).toISOString() } },
      { id: attacker.id, data: { billingStatus: 'terminated', billingStatusChangedAt: new Date(Date.now() - 400 * DAY).toISOString() } },
    ]
    for (const { id, data } of attempts) {
      await payload.update({ collection: 'municipalities', id, data: data as never, ...as(attackerAdmin) }).catch(() => null)
    }
    await payload
      .update({ collection: 'municipalities', where: { id: { exists: true } }, data: { billingStatus: 'terminated' } as never, ...as(attackerAdmin) })
      .catch(() => null)
    for (const o of [victim, attacker, doomed]) {
      const stored = await payload.findByID({ collection: 'municipalities', id: o.id, depth: 0, overrideAccess: true })
      expect(stored.billingStatus).toBe('active')
      expect(stored.billingStatusChangedAt ?? null).toBeNull()
    }
    expect(await inventory(victim)).toEqual(victimBefore)
  })

  it("the attacker's admin cannot move the victim's event into its own obec, nor edit the victim's", async () => {
    await payload
      .update({ collection: 'events', id: victimEvent.id, data: { municipality: attacker.id, title: 'ukradeno' } as never, ...as(attackerAdmin) })
      .catch(() => null)
    const stored = await payload.findByID({ collection: 'events', id: victimEvent.id, depth: 0, overrideAccess: true })
    expect(stored.municipality).toBe(victim.id)
    expect(stored.title).not.toBe('ukradeno')
    expect(await inventory(victim)).toEqual(victimBefore)
  })

  it('the erasure of an obec at its contract end takes only that obec: the others lose nothing, a shared event just loses the erased co-organizer', async () => {
    expect(await inventory(victim)).toEqual(victimBefore)
    await payload.create({ collection: 'sms-messages', data: { municipality: doomed.id, parts: 1 }, overrideAccess: true })
    await makeEvent(doomed, doomedAdmin, 3 * DAY)
    await payload.update({ collection: 'municipalities', id: doomed.id, data: { billingStatus: 'terminated' }, overrideAccess: true })
    await payload.update({
      collection: 'municipalities',
      id: doomed.id,
      data: { billingStatusChangedAt: new Date(Date.now() - (TERMINATED_DAYS + 1) * DAY).toISOString() },
      overrideAccess: true,
    })
    await confirm(doomed)

    const result = await advanceBillingStatuses(payload)
    expect(result.erased).toBeGreaterThanOrEqual(1)

    expect(await count('municipalities', { id: { equals: doomed.id } })).toBe(0)
    expect(await count('events', { municipality: { equals: doomed.id } })).toBe(0)
    expect(await count('sms-messages', { municipality: { equals: doomed.id } })).toBe(0)
    // The others are exactly as they were.
    expect(await inventory(victim)).toEqual(victimBefore)
    expect(await inventory(attacker)).toEqual(attackerBefore)
    const shared = await payload.findByID({ collection: 'events', id: victimEvent.id, depth: 0, overrideAccess: true })
    expect(shared.status).toBe('active')
    expect(shared.municipality).toBe(victim.id)
    expect(shared.coOrganizations ?? []).toHaveLength(0)
    // Their microregion lives on without it, and the residents' accounts are untouched.
    const region = await payload.findByID({ collection: 'microregions', id: regionId, depth: 0, overrideAccess: true })
    expect(((region.municipalities ?? []) as unknown[]).map((m) => Number(typeof m === 'object' ? (m as { id: number }).id : m)).sort()).toEqual(
      [victim.id, attacker.id].sort(),
    )
    expect(await count('users', { id: { in: [victimAdmin.id, attackerAdmin.id, doomedAdmin.id] } })).toBe(3)
  })

  it('only an obec whose contract ended AND whose period ran out is erased — every other state in the same run is left alone', async () => {
    const make = async (label: string, billingStatus: string, ageDays: number, confirmed = false) => {
      const { obec } = await makeObec(label)
      await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus } as never, overrideAccess: true })
      await payload.update({
        collection: 'municipalities',
        id: obec.id,
        data: { billingStatusChangedAt: new Date(Date.now() - ageDays * DAY).toISOString() },
        overrideAccess: true,
      })
      if (confirmed) await confirm(obec)
      return obec
    }
    const young = await make('terminated-young', 'terminated', TERMINATED_DAYS - 20)
    const readOnlyOld = await make('readonly-old', 'read_only', 400)
    const suspendedOld = await make('suspended-old', 'suspended', 400)
    const active = await make('active-old', 'active', 400)
    const expired = await make('terminated-expired', 'terminated', TERMINATED_DAYS + 5, true)
    // Past its period and never confirmed — stays, whatever the clock says.
    const unconfirmed = await make('terminated-unconfirmed', 'terminated', TERMINATED_DAYS + 5)

    await advanceBillingStatuses(payload)

    expect(await count('municipalities', { id: { equals: expired.id } })).toBe(0)
    for (const o of [young, readOnlyOld, suspendedOld, active, unconfirmed]) {
      expect(await count('municipalities', { id: { equals: o.id } })).toBe(1)
    }
    // Long overdue ones move one step — never straight to erasure.
    const status = async (o: Obec) =>
      (await payload.findByID({ collection: 'municipalities', id: o.id, depth: 0, overrideAccess: true })).billingStatus
    expect(await status(readOnlyOld)).toBe('terminated')
    expect(await status(suspendedOld)).toBe('read_only')
    expect(await status(active)).toBe('active')
    expect(await status(young)).toBe('terminated')
    // And again straight away: the terminated ones are young again, so nothing more goes today.
    await advanceBillingStatuses(payload)
    for (const o of [readOnlyOld, suspendedOld, active, young]) {
      expect(await count('municipalities', { id: { equals: o.id } })).toBe(1)
    }
    expect(await inventory(victim)).toEqual(victimBefore)
  })

  it('the leftovers cleanup refuses an id that is not a real obec — a bad value must never widen to every obec', async () => {
    for (const bad of [undefined, null, NaN, 0, -1, '1; DROP', {}] as unknown[]) {
      await expect(eraseObecLeftovers(payload, bad as number)).rejects.toThrow()
    }
    expect(await inventory(victim)).toEqual(victimBefore)
    expect(await inventory(attacker)).toEqual(attackerBefore)
  })
})
