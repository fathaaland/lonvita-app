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
import { DEFAULT_CATALOG } from '@/lib/billing/catalog'
import { billedTierOf, monthStartsBetween, proratedSurcharge, reviewLicenceTiers } from '@/lib/billing/licence-tier'
import { licencePeriodOf, pragueMonthKey } from '@/lib/billing/period'
import { getMunicipalityServices } from '@/lib/services/municipality-services'

let payload: Payload
const STAMP = Date.now()
const DAY = 86_400_000
const TIERS = DEFAULT_CATALOG.licenceTiers

type TestUser = { id: number; email: string; role: string }

/**
 * Přechod licenčního pásma (bod 11): the band is fixed for the licence year; growth moves it up from the
 * next month with the price difference for the months left — never back; a smaller obec gets the lower
 * band only at renewal. A band or price set by hand is left alone. Only the job and the platform touch it.
 */
describe('Licence band — fixed for the year, raised on growth, never back-charged', () => {
  let platform: TestUser
  const userIds: number[] = []
  const obecIds: number[] = []

  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `tier-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  /** A calendar-year licence paid for the year, with its own admin. */
  const makeObec = async (label: string, data: Record<string, unknown> = {}) => {
    const obec = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Tier ${label} ${STAMP}`,
        lat: 49.4,
        lng: 15.2,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
        licencePaidUntil: new Date(Date.now() + 400 * DAY).toISOString(),
        ...data,
      },
      overrideAccess: true,
    })
    obecIds.push(obec.id)
    const admin = await makeUser(`admin-${label}`)
    await payload.create({ collection: 'user-roles', data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
    return { obec, admin }
  }
  /** Three monthly snapshots of `users` — what the band is computed from. */
  const snapshots = async (municipalityId: number, users: number) => {
    await payload.delete({ collection: 'active-user-snapshots', where: { municipality: { equals: municipalityId } }, overrideAccess: true })
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      await payload.create({
        collection: 'active-user-snapshots',
        data: { municipality: municipalityId, month, activeUsers: users, takenAt: new Date().toISOString() },
        overrideAccess: true,
      })
    }
  }
  const read = (id: number) => payload.findByID({ collection: 'municipalities', id, depth: 0, overrideAccess: true })
  const upgradesOf = async (id: number) =>
    (await payload.find({ collection: 'licence-upgrades', where: { municipality: { equals: id } }, overrideAccess: true })).docs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    platform = await makeUser('root', 'admin')
  }, 120_000)

  afterAll(async () => {
    for (const id of obecIds) await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  describe('the arithmetic', () => {
    it('counts whole billing months from the month start on', () => {
      const jan1 = new Date('2025-12-31T23:00:00.000Z') // 1. 1. 2026 in Prague
      const next = new Date('2026-12-31T23:00:00.000Z')
      expect(monthStartsBetween(jan1, next)).toBe(12)
      // From mid-January: February to December.
      expect(monthStartsBetween(new Date('2026-01-15T00:00:00.000Z'), next)).toBe(11)
      expect(monthStartsBetween(next, next)).toBe(0)
    })

    it('prorates the price difference for the months left — never negative', () => {
      expect(proratedSurcharge(70_000, 100_000, 6, 12)).toBe(15_000)
      expect(proratedSurcharge(36_000, 70_000, 1, 12)).toBe(2_833)
      expect(proratedSurcharge(100_000, 70_000, 6, 12)).toBe(0)
      expect(proratedSurcharge(70_000, 100_000, 0, 12)).toBe(0)
    })

    it('bills the band fixed for this year — a hand-set band always wins, a stale one is ignored', () => {
      expect(billedTierOf({ licenceTier: 5, licenceBilledTier: 2, licenceBilledTierPeriod: 'p' }, 'p', 1)).toEqual({ tier: 5, fixed: true })
      expect(billedTierOf({ licenceBilledTier: 2, licenceBilledTierPeriod: 'p' }, 'p', 1)).toEqual({ tier: 2, fixed: true })
      expect(billedTierOf({ licenceBilledTier: 2, licenceBilledTierPeriod: 'old' }, 'p', 1)).toEqual({ tier: 1, fixed: false })
    })
  })

  describe('the daily review', () => {
    it('fixes the band for the year from the snapshots — and bills by it', async () => {
      const { obec } = await makeObec('fix')
      await snapshots(obec.id, 250) // band 1 (101–300)
      await reviewLicenceTiers(payload)
      const stored = await read(obec.id)
      const key = licencePeriodOf(stored, new Date()).key
      expect(stored.licenceBilledTier).toBe(1)
      expect(stored.licenceBilledTierPeriod).toBe(key)
      const services = await getMunicipalityServices(payload, obec.id, new Date())
      expect(services.licence).toMatchObject({ tier: 1, tierFixedForYear: true, yearlyPriceCzk: TIERS[1].yearlyPriceCzk })
    })

    it('growth mid-year: moves up from next month, the months left charged — once; never back', async () => {
      const { obec, admin } = await makeObec('grow')
      await snapshots(obec.id, 250)
      await reviewLicenceTiers(payload) // fixed at band 1
      await snapshots(obec.id, 450) // band 2 (301–500)
      const now = new Date()
      await reviewLicenceTiers(payload, now)

      expect((await read(obec.id)).licenceBilledTier).toBe(2)
      const [upgrade] = await upgradesOf(obec.id)
      const period = licencePeriodOf(await read(obec.id), now)
      const expectedMonths = monthStartsBetween(new Date(upgrade.effectiveFrom), period.paidEnd)
      expect(upgrade).toMatchObject({ fromTier: 1, toTier: 2, averageUsers: 450, monthsCharged: expectedMonths })
      // From the next month, not this one — nothing back.
      expect(pragueMonthKey(new Date(upgrade.effectiveFrom))).not.toBe(pragueMonthKey(now))
      expect(new Date(upgrade.effectiveFrom).getTime()).toBeGreaterThan(now.getTime())
      expect(upgrade.surchargeCzk).toBe(
        proratedSurcharge(TIERS[1].yearlyPriceCzk, TIERS[2].yearlyPriceCzk, upgrade.monthsCharged, upgrade.periodMonths),
      )
      await vi.waitFor(async () => {
        const notices = await payload.find({
          collection: 'notifications',
          where: { and: [{ user: { equals: admin.id } }, { title: { equals: 'Licence obce přechází do vyššího pásma' } }] },
          overrideAccess: true,
        })
        expect(notices.docs).toHaveLength(1)
        // The obec doesn't see prices.
        expect(notices.docs[0].message).not.toMatch(/Kč/)
      })

      // The next night — the same users: nothing new.
      await reviewLicenceTiers(payload)
      expect(await upgradesOf(obec.id)).toHaveLength(1)
      expect((await getMunicipalityServices(payload, obec.id, new Date())).licence.tier).toBe(2)
    })

    it('fewer users mid-year: the band stays until renewal', async () => {
      const { obec } = await makeObec('shrink')
      await snapshots(obec.id, 450)
      await reviewLicenceTiers(payload) // band 2
      await snapshots(obec.id, 90) // would be band 0
      await reviewLicenceTiers(payload)
      expect((await read(obec.id)).licenceBilledTier).toBe(2)
      expect(await upgradesOf(obec.id)).toHaveLength(0)
    })

    it('at renewal (a new licence year) the band is fixed afresh — down as well as up, no surcharge', async () => {
      const { obec } = await makeObec('renew')
      await snapshots(obec.id, 450)
      await reviewLicenceTiers(payload) // band 2 for this year
      await snapshots(obec.id, 90)
      // As if the year was the last one: the stored key no longer matches the period now.
      await payload.update({ collection: 'municipalities', id: obec.id, data: { licenceBilledTierPeriod: '2020-01-01' }, overrideAccess: true })
      await reviewLicenceTiers(payload)
      expect((await read(obec.id)).licenceBilledTier).toBe(0)
      expect(await upgradesOf(obec.id)).toHaveLength(0)
    })

    it('a hand-set band, an individual price or a lapsed licence are left alone', async () => {
      const { obec: manual } = await makeObec('manual', { licenceTier: 0 })
      const { obec: custom } = await makeObec('custom', { licenceCustomYearlyCzk: 120_000 })
      const { obec: lapsed } = await makeObec('lapsed', { licencePaidUntil: new Date(Date.now() - DAY).toISOString() })
      for (const o of [manual, custom, lapsed]) await snapshots(o.id, 1400)
      await reviewLicenceTiers(payload)
      for (const o of [manual, custom, lapsed]) {
        expect((await read(o.id)).licenceBilledTier ?? null).toBeNull()
        expect(await upgradesOf(o.id)).toHaveLength(0)
      }
      expect((await getMunicipalityServices(payload, manual.id, new Date())).licence.tier).toBe(0)
    })

    it('upgrades go with the obec when it is deleted', async () => {
      const { obec } = await makeObec('deleted')
      await snapshots(obec.id, 250)
      await reviewLicenceTiers(payload)
      await snapshots(obec.id, 450)
      await reviewLicenceTiers(payload)
      expect(await upgradesOf(obec.id)).toHaveLength(1)
      await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true })
      expect(await upgradesOf(obec.id)).toHaveLength(0)
    })
  })

  describe('over the real REST API', () => {
    const tokenOf = async (u: TestUser) =>
      (await payload.login({ collection: 'users', data: { email: u.email, password: 'test1234' } })).token as string
    const call = async (handler: typeof GET, method: string, path: string, token: string | null, body?: unknown) => {
      const response = await handler(
        new Request(`http://localhost/api/${path}`, {
          method,
          headers: { ...(token ? { Authorization: `JWT ${token}` } : {}), 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { params: Promise.resolve({ slug: path.split('?')[0].split('/') }) },
      )
      return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> }
    }

    it('an obec admin cannot lower its band, fix it, or touch its upgrade records — nor see them', async () => {
      const { obec, admin } = await makeObec('rest')
      await snapshots(obec.id, 250)
      await reviewLicenceTiers(payload)
      await snapshots(obec.id, 450)
      await reviewLicenceTiers(payload)
      const before = await read(obec.id)
      const [upgrade] = await upgradesOf(obec.id)
      const token = await tokenOf(admin)

      await call(PATCH, 'PATCH', `municipalities/${obec.id}`, token, {
        licenceTier: 0,
        licenceBilledTier: 0,
        licenceBilledTierPeriod: '2099-01-01',
        licenceCustomYearlyCzk: 1,
      })
      await call(PATCH, 'PATCH', 'municipalities?where[id][exists]=true', token, { licenceTier: 0, licenceBilledTier: 0 })
      const after = await read(obec.id)
      for (const field of ['licenceTier', 'licenceBilledTier', 'licenceBilledTierPeriod', 'licenceCustomYearlyCzk'] as const) {
        expect(after[field] ?? null, field).toEqual(before[field] ?? null)
      }

      expect((await call(GET, 'GET', 'licence-upgrades', token)).status).toBe(403)
      expect((await call(GET, 'GET', `licence-upgrades/${upgrade.id}`, token)).status).toBe(403)
      expect((await call(POST, 'POST', 'licence-upgrades', token, { municipality: obec.id, periodKey: 'x', fromTier: 0, toTier: 0, averageUsers: 0, effectiveFrom: new Date().toISOString(), monthsCharged: 0, periodMonths: 1, fromYearlyCzk: 0, toYearlyCzk: 0, surchargeCzk: 0 })).status).toBe(403)
      expect((await call(PATCH, 'PATCH', `licence-upgrades/${upgrade.id}`, token, { surchargeCzk: 0 })).status).toBe(403)
      expect((await call(DELETE, 'DELETE', `licence-upgrades/${upgrade.id}`, token)).status).toBe(403)
      expect((await upgradesOf(obec.id))[0].surchargeCzk).toBe(upgrade.surchargeCzk)

      // The raw fields aren't readable to it either.
      const own = await call(GET, 'GET', `municipalities/${obec.id}`, token)
      expect(own.json.licenceBilledTier).toBeUndefined()
      expect(own.json.licenceBilledTierPeriod).toBeUndefined()
    })

    it('not even a platform admin rewrites an upgrade record or the fixed band over the API — they set a band by hand instead', async () => {
      const { obec } = await makeObec('platform')
      await snapshots(obec.id, 250)
      await reviewLicenceTiers(payload)
      await snapshots(obec.id, 450)
      await reviewLicenceTiers(payload)
      const [upgrade] = await upgradesOf(obec.id)
      const token = await tokenOf(platform)
      expect((await call(GET, 'GET', `licence-upgrades/${upgrade.id}`, token)).status).toBe(200)
      expect((await call(PATCH, 'PATCH', `licence-upgrades/${upgrade.id}`, token, { surchargeCzk: 0 })).status).toBe(403)
      expect((await call(DELETE, 'DELETE', `licence-upgrades/${upgrade.id}`, token)).status).toBe(403)
      await call(PATCH, 'PATCH', `municipalities/${obec.id}`, token, { licenceBilledTier: 0 })
      expect((await read(obec.id)).licenceBilledTier).toBe(2)
      // The hand-set band is the platform's lever — and it wins.
      expect((await call(PATCH, 'PATCH', `municipalities/${obec.id}`, token, { licenceTier: 1 })).status).toBe(200)
      expect((await getMunicipalityServices(payload, obec.id, new Date())).licence).toMatchObject({ tier: 1, tierManual: true })
    })
  })
})
