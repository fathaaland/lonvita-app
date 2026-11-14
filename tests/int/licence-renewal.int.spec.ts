// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

import { licenceLapsed, licencePeriodOf } from '@/lib/billing/period'
import { smsUsageOf } from '@/lib/billing/sms'
import { claimSmsParts } from '@/lib/billing/sms-ledger'
import { LICENCE_GRACE_DAYS, NEW_OBEC_PAYMENT_DAYS } from '@/lib/billing/status'
import { advanceBillingStatuses } from '@/lib/billing/status-step'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

/**
 * Automatická obnova licenčního roku (bod 9): the licence year turns only as far as it is paid
 * (Municipalities.licencePaidUntil) — past that, no new SMS quota; the obec's admins are told a week
 * ahead and on the day; LICENCE_GRACE_DAYS later it is suspended by itself. Only the platform sets the
 * date — through no API can an obec, or anybody else, extend its own licence.
 */
describe('Licence renewal — no new year without a payment', () => {
  let platform: TestUser
  let resident: TestUser
  const userIds: number[] = []
  const obecIds: number[] = []

  const as = (u: TestUser) => ({ user: { ...u, collection: 'users' as const }, overrideAccess: false as const })
  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `licence-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  /** An obec with its own admin. */
  const makeObec = async (label: string, data: Record<string, unknown> = {}) => {
    const obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Licence ${label} ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', ...data },
      overrideAccess: true,
    })
    obecIds.push(obec.id)
    const admin = await makeUser(`admin-${label}`)
    await payload.create({ collection: 'user-roles', data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
    return { obec, admin }
  }
  const read = (id: number) => payload.findByID({ collection: 'municipalities', id, depth: 0, overrideAccess: true })
  const noticesFor = async (user: TestUser, title: string) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { and: [{ user: { equals: user.id } }, { title: { equals: title } }] },
        pagination: false,
        overrideAccess: true,
      })
    ).docs
  const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    platform = await makeUser('root', 'admin')
    resident = await makeUser('resident')
  }, 120_000)

  afterAll(async () => {
    for (const id of obecIds) {
      await payload.delete({ collection: 'sms-messages', where: { municipality: { equals: id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  it('the licence period stops turning at the paid-until date', () => {
    const monthly = { licencePeriodStart: '2026-01-01T00:00:00.000Z', licencePeriodEnd: '2026-02-01T00:00:00.000Z' }
    const feb10 = new Date('2026-02-10T00:00:00.000Z')
    // Paid through March: February is its own period.
    const paid = licencePeriodOf({ ...monthly, licencePaidUntil: '2026-03-01T00:00:00.000Z' }, feb10)
    expect(paid).toMatchObject({ lapsed: false })
    expect(paid.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(paid.end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    // Paid only through January: the year doesn't turn — still January's period, counting on.
    const lapsed = licencePeriodOf({ ...monthly, licencePaidUntil: '2026-02-01T00:00:00.000Z' }, feb10)
    expect(lapsed.lapsed).toBe(true)
    expect(lapsed.start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(lapsed.paidEnd.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(lapsed.end.getTime()).toBeGreaterThan(feb10.getTime())
    expect(lapsed.key).toBe('2026-01-01')
    // The calendar year likewise — paid until midnight in Prague at the year's turn.
    const cal = licencePeriodOf({ licencePaidUntil: '2025-12-31T23:00:00.000Z' }, new Date('2026-06-01T00:00:00.000Z'))
    expect(cal.lapsed).toBe(true)
    expect(cal.key.startsWith('2025')).toBe(true)
    expect(licenceLapsed({ licencePaidUntil: '2026-01-01T00:00:00.000Z' }, new Date('2025-12-31T00:00:00.000Z'))).toBe(false)
    expect(licenceLapsed({ licencePaidUntil: null }, new Date())).toBe(false)
  })

  it('an unrenewed licence gets no new SMS quota — what it sends keeps counting against the last paid year', async () => {
    const { obec } = await makeObec('quota', {
      smsEnabled: true,
      smsQuotaOverride: 2,
      licencePeriodStart: '2026-01-01T00:00:00.000Z',
      licencePeriodEnd: '2026-02-01T00:00:00.000Z',
      licencePaidUntil: '2026-02-01T00:00:00.000Z',
    })
    // January's quota used up in January.
    await payload.create({
      collection: 'sms-messages',
      data: { municipality: obec.id, requestId: `event-cancelled-licjan${STAMP}-1`, parts: 2, createdAt: '2026-01-15T10:00:00.000Z' } as never,
      overrideAccess: true,
    })
    const feb10 = new Date('2026-02-10T00:00:00.000Z')
    const usage = await smsUsageOf(payload, obec.id, feb10)
    expect(usage.period.lapsed).toBe(true)
    expect(usage.usedParts).toBe(2)
    expect(await claimSmsParts(payload, { municipalityId: obec.id, requestId: `event-cancelled-licfeb${STAMP}-1`, parts: 1, now: feb10 })).toEqual({
      decision: 'skip',
      reason: 'quota_used_up',
    })

    // Renewed: February is a new year with a fresh quota.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { licencePaidUntil: '2026-03-01T00:00:00.000Z' }, ...as(platform) })
    expect(await claimSmsParts(payload, { municipalityId: obec.id, requestId: `event-cancelled-licfeb2${STAMP}-1`, parts: 1, now: feb10 })).toMatchObject({
      decision: 'send',
    })
  })

  it('a new obec gets a limited time to pay — never an open-ended licence; the platform cannot clear the date', async () => {
    const before = Date.now()
    const { obec } = await makeObec('new')
    const paidUntil = new Date((await read(obec.id)).licencePaidUntil!).getTime()
    expect(paidUntil).toBeGreaterThanOrEqual(before + NEW_OBEC_PAYMENT_DAYS * DAY - 60_000)
    expect(paidUntil).toBeLessThanOrEqual(Date.now() + NEW_OBEC_PAYMENT_DAYS * DAY + 60_000)
    await expect(
      payload.update({ collection: 'municipalities', id: obec.id, data: { licencePaidUntil: null }, ...as(platform) }),
    ).rejects.toThrow()
    expect((await read(obec.id)).licencePaidUntil).toBeTruthy()
  })

  it('warns a week ahead and on the day — once each — then suspends after the grace period', async () => {
    const { obec: soon, admin: soonAdmin } = await makeObec('soon', { licencePaidUntil: inDays(3) })
    const { obec: expired, admin: expiredAdmin } = await makeObec('expired', { licencePaidUntil: inDays(-2) })
    const { obec: overdue, admin: overdueAdmin } = await makeObec('overdue', { licencePaidUntil: inDays(-(LICENCE_GRACE_DAYS + 1)) })
    const { obec: paid } = await makeObec('paid', { licencePaidUntil: inDays(200) })

    const first = await advanceBillingStatuses(payload)
    expect(first.licenceSuspended).toBeGreaterThanOrEqual(1)
    await advanceBillingStatuses(payload)

    await vi.waitFor(async () => {
      expect(await noticesFor(soonAdmin, 'Licence obce brzy vyprší')).toHaveLength(1)
      expect(await noticesFor(expiredAdmin, 'Licence obce vypršela')).toHaveLength(1)
      expect(await noticesFor(overdueAdmin, 'Licence obce je pozastavená')).toHaveLength(1)
    })
    expect((await read(soon.id)).billingStatus).toBe('active')
    expect((await read(expired.id)).billingStatus).toBe('active')
    expect((await read(overdue.id)).billingStatus).toBe('suspended')
    expect((await read(paid.id)).billingStatus).toBe('active')
    expect((await read(paid.id)).licenceReminderState ?? null).toBeNull()

    // Renewed by the platform and set active again — the job leaves it alone.
    await payload.update({ collection: 'municipalities', id: overdue.id, data: { licencePaidUntil: inDays(365), billingStatus: 'active' }, ...as(platform) })
    await advanceBillingStatuses(payload)
    expect((await read(overdue.id)).billingStatus).toBe('active')
  })

  it('a suspended obec is moved on by its own stage clock only — the licence check never touches it', async () => {
    const { obec } = await makeObec('already-suspended', { licencePaidUntil: inDays(-400) })
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'suspended' }, overrideAccess: true })
    await advanceBillingStatuses(payload)
    const stored = await read(obec.id)
    expect(stored.billingStatus).toBe('suspended')
    expect(stored.licenceReminderState ?? null).toBeNull()
  })

  it('no obec admin, other obec admin or resident can extend a licence or silence its reminders — single or bulk; nor read it', async () => {
    const { obec, admin } = await makeObec('attacked', { licencePaidUntil: inDays(-2) })
    const { admin: otherAdmin } = await makeObec('other')
    const original = (await read(obec.id)).licencePaidUntil
    const forged = {
      licencePaidUntil: inDays(3650),
      licenceReminderState: `${original}|expired`,
      licencePeriodStart: '2020-01-01T00:00:00.000Z',
      smsQuotaOverride: 100000,
    } as never
    for (const attacker of [admin, otherAdmin, resident]) {
      await payload.update({ collection: 'municipalities', id: obec.id, data: forged, ...as(attacker) }).catch(() => null)
      await payload.update({ collection: 'municipalities', where: { id: { exists: true } }, data: forged, ...as(attacker) }).catch(() => null)
    }
    const after = await read(obec.id)
    expect(after.licencePaidUntil).toBe(original)
    expect(after.licenceReminderState ?? null).toBeNull()
    expect(after.licencePeriodStart ?? null).toBeNull()
    expect(after.smsQuotaOverride ?? null).toBeNull()
    // The obec admin doesn't see the raw fields — only their own obec's services summary.
    const asAdmin = await payload.findByID({ collection: 'municipalities', id: obec.id, ...as(admin) })
    expect(asAdmin.licencePaidUntil).toBeUndefined()
    expect((asAdmin as { licenceReminderState?: unknown }).licenceReminderState).toBeUndefined()
    // Not even a platform admin writes the reminder state through the API — only the job does.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { licenceReminderState: 'x|expired' } as never, ...as(platform) })
    expect((await read(obec.id)).licenceReminderState ?? null).toBeNull()
  })

  it('the platform renewing a licence is on the record — who, when, from what to what', async () => {
    const { obec } = await makeObec('audited', { licencePaidUntil: inDays(10) })
    const from = (await read(obec.id)).licencePaidUntil
    const to = inDays(375)
    await payload.update({ collection: 'municipalities', id: obec.id, data: { licencePaidUntil: to }, ...as(platform) })
    await vi.waitFor(async () => {
      const entries = await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: 'municipalities.billing-change' } }, { targetId: { equals: String(obec.id) } }] },
        sort: '-createdAt',
        overrideAccess: true,
      })
      expect(entries.docs[0]?.metadata).toMatchObject({ changes: { licencePaidUntil: { from } } })
      expect(entries.docs[0]?.actor).toBeTruthy()
    })
  })
})
