// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

import { GET, PATCH } from '@/app/(payload)/api/[...slug]/route'
import { autumnAverageUsers } from '@/lib/billing/active-users'
import { DEFAULT_CATALOG } from '@/lib/billing/catalog'
import { contractYearOf, licenceQuote } from '@/lib/billing/licence-price'
import { reviewLicenceTiers } from '@/lib/billing/licence-tier'
import { licencePeriodOf } from '@/lib/billing/period'
import { TRIAL_TERMINATED_DAYS, nextBillingStepAt } from '@/lib/billing/status'
import { advanceBillingStatuses } from '@/lib/billing/status-step'
import { getMunicipalityServices } from '@/lib/services/municipality-services'

let payload: Payload
const STAMP = Date.now()
const DAY = 86_400_000
const C = DEFAULT_CATALOG

type TestUser = { id: number; email: string; role: string }

/** A licence year starting `start` (calendar unless set). */
const period = (start = '2026-01-01T00:00:00.000Z') => ({ key: start.slice(0, 10), start: new Date(start) })

/**
 * Ceník 2027 (13. 11. 2026): the licence is priced by the obec's inhabitants, fixed for the licence year;
 * the growth band (active users over 5 % of the inhabitants) moves it one band up from the next period,
 * decided in the autumn; floors, the first wave, a 3-year contract, a reference, inflation and trials.
 * Only the platform sets any of it — through no API can an obec change its price.
 */
describe('Ceník 2027 — licence by inhabitants', () => {
  describe('the price of a licence year', () => {
    it('is the band by inhabitants — 21 000 obyvatel: band 6 (index 5), 118 800 Kč, implementation 15 000', () => {
      const q = licenceQuote(C, { population: 21_000 }, period())
      expect(q).toMatchObject({ baseTier: 5, tier: 5, priceCzk: 118_800, floorCzk: 108_000, implementationFeeCzk: 15_000, belowFloor: false })
    })

    it('Žďár (pásmo 5, under 20 000): 85 800 Kč; the first wave pays the floor (78 000) its first year, the list price from the second', () => {
      const zdar = { population: 19_500, firstWave: true, contractStart: '2027-01-01T00:00:00.000Z' }
      expect(licenceQuote(C, zdar, period('2027-02-01T00:00:00.000Z')).priceCzk).toBe(78_000)
      expect(licenceQuote(C, zdar, period('2028-02-01T00:00:00.000Z')).priceCzk).toBe(85_800)
      expect(licenceQuote(C, { population: 19_500 }, period()).priceCzk).toBe(85_800)
    })

    it('moves by the inflation entered from the second year; a 3-year contract is 5 % off (the first wave from year 2)', () => {
      const m = { population: 21_000, contractStart: '2026-01-01T00:00:00.000Z', priceIndexPercent: 3 }
      expect(licenceQuote(C, m, period('2026-01-01T00:00:00.000Z')).priceCzk).toBe(118_800)
      expect(licenceQuote(C, m, period('2027-01-01T00:00:00.000Z')).priceCzk).toBe(Math.round(118_800 * 1.03))
      expect(licenceQuote(C, { ...m, priceIndexPercent: 0, contractYears: 3 }, period()).priceCzk).toBe(Math.round(118_800 * 0.95))
      const wave = { population: 21_000, contractYears: 3, firstWave: true, contractStart: '2026-01-01T00:00:00.000Z' }
      expect(licenceQuote(C, wave, period('2026-02-01T00:00:00.000Z')).priceCzk).toBe(108_000)
      expect(licenceQuote(C, wave, period('2027-02-01T00:00:00.000Z')).priceCzk).toBe(Math.round(118_800 * 0.95))
    })

    it('a reference halves the implementation; an individual one stands', () => {
      expect(licenceQuote(C, { population: 21_000, referenceDiscount: true }, period()).implementationFeeCzk).toBe(7_500)
      expect(licenceQuote(C, { population: 21_000, implementationFeeCzk: 2_000 }, period()).implementationFeeCzk).toBe(2_000)
    })

    it("the contract's own price stands as it is; below the floor it is flagged", () => {
      const q = licenceQuote(C, { population: 21_000, licenceCustomYearlyCzk: 100_000, contractYears: 3 }, period())
      expect(q).toMatchObject({ priceCzk: 100_000, customPrice: true, floorCzk: 108_000, belowFloor: true })
    })

    it('the last band is individual — without a contract price there is none; without inhabitants nothing is known', () => {
      expect(licenceQuote(C, { population: 400_000 }, period())).toMatchObject({ tier: 7, priceCzk: null })
      expect(licenceQuote(C, { population: 400_000 }, period()).missing).toContain('individuální cena (poslední pásmo)')
      expect(licenceQuote(C, { population: 400_000, licenceCustomYearlyCzk: 167_880 }, period()).priceCzk).toBe(167_880)
      expect(licenceQuote(C, {}, period())).toMatchObject({ tier: null, priceCzk: null, missing: ['počet obyvatel'] })
    })

    it('the growth band: one band up, its price never over 200 000 Kč — into the individual band too', () => {
      const p = period()
      expect(licenceQuote(C, { population: 21_000, licenceBilledTier: 6, licenceBilledTierPeriod: p.key }, p)).toMatchObject({
        tier: 6,
        growthSteps: 1,
        priceCzk: 165_000,
      })
      expect(licenceQuote(C, { population: 60_000, licenceBilledTier: 7, licenceBilledTierPeriod: p.key }, p)).toMatchObject({
        tier: 7,
        growthSteps: 1,
        priceCzk: 200_000,
      })
      // A band fixed for another year doesn't count.
      expect(licenceQuote(C, { population: 21_000, licenceBilledTier: 6, licenceBilledTierPeriod: '2020-01-01' }, p).tier).toBe(5)
    })

    it("counts the years of the contract — the first wave's licence starts a month after it", () => {
      expect(contractYearOf({ contractStart: '2026-01-01T00:00:00.000Z' }, new Date('2026-01-01T00:00:00.000Z'))).toBe(1)
      expect(contractYearOf({ contractStart: '2026-01-01T00:00:00.000Z' }, new Date('2027-01-01T00:00:00.000Z'))).toBe(2)
      expect(contractYearOf({ contractStart: '2026-12-31T23:00:00.000Z', firstWave: true }, new Date('2027-01-31T23:00:00.000Z'))).toBe(1)
      expect(contractYearOf({}, new Date())).toBe(1)
    })

    it('the autumn average is of the end-of-September and end-of-October snapshots', () => {
      const snap = (month: string, activeUsers: number) => ({ month, activeUsers, takenAt: '', byHand: false })
      expect(autumnAverageUsers([snap('2026-12', 9999), snap('2026-11', 1100), snap('2026-10', 900), snap('2026-09', 5)], 2026)).toBe(1000)
      expect(autumnAverageUsers([snap('2026-10', 900)], 2026)).toBe(900)
      expect(autumnAverageUsers([snap('2026-09', 900)], 2026)).toBeNull()
    })
  })

  describe('against the database', () => {
    let platform: TestUser
    let resident: TestUser
    const userIds: number[] = []
    const obecIds: number[] = []

    const as = (u: TestUser) => ({ user: { ...u, collection: 'users' as const }, overrideAccess: false as const })
    const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
      const u = (await payload.create({
        collection: 'users',
        data: { email: `pricing-${name}-${STAMP}@test.local`, password: 'test1234', role },
        overrideAccess: true,
      })) as TestUser
      userIds.push(u.id)
      return u
    }
    const makeObec = async (label: string, data: Record<string, unknown> = {}) => {
      const obec = await payload.create({
        collection: 'municipalities',
        data: {
          name: `Pricing ${label} ${STAMP}`,
          lat: 49.4,
          lng: 15.2,
          eventRadiusKm: 15,
          rulesForCreation: 'approved_organizers',
          licencePaidUntil: '2029-01-01T00:00:00.000Z',
          ...data,
        },
        overrideAccess: true,
      })
      obecIds.push(obec.id)
      const admin = await makeUser(`admin-${label}`)
      await payload.create({ collection: 'user-roles', data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
      return { obec, admin }
    }
    const snapshot = (municipality: number, month: string, activeUsers: number) =>
      payload.create({
        collection: 'active-user-snapshots',
        data: { municipality, month, activeUsers, takenAt: new Date().toISOString() },
        overrideAccess: true,
      })
    const read = (id: number) => payload.findByID({ collection: 'municipalities', id, depth: 0, overrideAccess: true })
    const notices = async (u: TestUser, title: string) =>
      (await payload.find({ collection: 'notifications', where: { and: [{ user: { equals: u.id } }, { title: { equals: title } }] }, overrideAccess: true })).docs

    beforeAll(async () => {
      payload = await getPayload({ config: await config })
      platform = await makeUser('root', 'admin')
      resident = await makeUser('resident')
    }, 120_000)

    afterAll(async () => {
      for (const id of obecIds) await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
      for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    })

    it('the growth band: fixed for the year, decided in the autumn, one band up from the next period — back when it is over', async () => {
      // 21 000 obyvatel → band index 5; 5 % = 1 050 included.
      const { obec, admin } = await makeObec('growth', { population: 21_000 })
      await reviewLicenceTiers(payload, new Date('2026-06-15T10:00:00.000Z'))
      expect(await read(obec.id)).toMatchObject({ licenceBilledTier: 5, licenceBilledTierPeriod: '2026-01-01' })

      // Mid-year: more inhabitants entered, a crowd of users — the band holds all year.
      await payload.update({ collection: 'municipalities', id: obec.id, data: { population: 60_000 }, overrideAccess: true })
      await payload.update({ collection: 'municipalities', id: obec.id, data: { population: 21_000 }, overrideAccess: true })
      await snapshot(obec.id, '2026-10', 1_200)
      await snapshot(obec.id, '2026-11', 1_300)
      await reviewLicenceTiers(payload, new Date('2026-10-20T10:00:00.000Z')) // before November: nothing yet
      expect((await read(obec.id)).licenceNextTier ?? null).toBeNull()

      await reviewLicenceTiers(payload, new Date('2026-11-02T10:00:00.000Z'))
      expect(await read(obec.id)).toMatchObject({ licenceBilledTier: 5, licenceNextTier: 6, licenceNextTierUsers: 1_250 })
      await vi.waitFor(async () => expect(await notices(admin, 'Od dalšího období vyšší licenční pásmo')).toHaveLength(1))
      // Once a year.
      await reviewLicenceTiers(payload, new Date('2026-11-20T10:00:00.000Z'))
      expect(await notices(admin, 'Od dalšího období vyšší licenční pásmo')).toHaveLength(1)

      // January: the new year is billed one band up.
      await reviewLicenceTiers(payload, new Date('2027-01-05T10:00:00.000Z'))
      const jan = await read(obec.id)
      expect(jan).toMatchObject({ licenceBilledTier: 6, licenceBilledTierPeriod: '2027-01-01' })
      const services = await getMunicipalityServices(payload, obec.id, new Date('2027-01-05T10:00:00.000Z'))
      expect(services.licence).toMatchObject({ baseTier: 5, tier: 6, growthSteps: 1, yearlyPriceCzk: 165_000 })

      // Next autumn back under 5 %: back to the band by size from 2028.
      await snapshot(obec.id, '2027-10', 400)
      await snapshot(obec.id, '2027-11', 500)
      await reviewLicenceTiers(payload, new Date('2027-11-03T10:00:00.000Z'))
      expect((await read(obec.id)).licenceNextTier).toBe(5)
      await vi.waitFor(async () => expect(await notices(admin, 'Od dalšího období zpět pásmo podle velikosti obce')).toHaveLength(1))
    })

    it('a band by hand, an individual price or a lapsed licence are left alone; an obec without inhabitants too', async () => {
      const { obec: manual } = await makeObec('manual', { population: 21_000, licenceTier: 2 })
      const { obec: custom } = await makeObec('custom', { population: 21_000, licenceCustomYearlyCzk: 120_000, floorExceptionNote: 'pilot' })
      const { obec: lapsed } = await makeObec('lapsed', { population: 21_000, licencePaidUntil: '2026-01-01T00:00:00.000Z' })
      const { obec: unknown } = await makeObec('unknown')
      for (const o of [manual, custom, lapsed, unknown]) {
        await snapshot(o.id, '2026-10', 5_000)
        await snapshot(o.id, '2026-11', 5_000)
      }
      await reviewLicenceTiers(payload, new Date('2026-11-05T10:00:00.000Z'))
      for (const o of [manual, custom, lapsed, unknown]) {
        const stored = await read(o.id)
        expect(stored.licenceBilledTier ?? null).toBeNull()
        expect(stored.licenceNextTier ?? null).toBeNull()
      }
    })

    it('a price under the floor is saved only with an exception', async () => {
      const { obec } = await makeObec('floor', { population: 21_000 })
      await expect(
        payload.update({ collection: 'municipalities', id: obec.id, data: { licenceCustomYearlyCzk: 90_000 }, ...as(platform) }),
      ).rejects.toThrow(/spodní hranicí/)
      const ok = await payload.update({
        collection: 'municipalities',
        id: obec.id,
        data: { licenceCustomYearlyCzk: 90_000, floorExceptionNote: 'mikroregion Žďársko, dohoda s Davidem' },
        ...as(platform),
      })
      expect(ok.licenceCustomYearlyCzk).toBe(90_000)
      // The first wave at the floor isn't under it.
      await payload.update({ collection: 'municipalities', id: obec.id, data: { licenceCustomYearlyCzk: null, floorExceptionNote: null, firstWave: true }, ...as(platform) })
    })

    it('a trial: its admins are reminded before the last day to say no; an obec that ends with it goes after 30 days', async () => {
      const end = new Date(Date.now() + 18 * DAY).toISOString()
      const { obec, admin } = await makeObec('trial', { population: 1_500, trialEndsAt: end })
      expect((await getMunicipalityServices(payload, obec.id, new Date())).licence.inTrial).toBe(true)
      await advanceBillingStatuses(payload)
      await advanceBillingStatuses(payload)
      await vi.waitFor(async () => expect(await notices(admin, 'Zkušební provoz Lonvity brzy končí')).toHaveLength(1))

      const changedAt = new Date().toISOString()
      expect(nextBillingStepAt('terminated', changedAt, end)?.getTime()).toBe(new Date(changedAt).getTime() + TRIAL_TERMINATED_DAYS * DAY)
      // Long after a trial — the usual 90 days.
      expect(nextBillingStepAt('terminated', changedAt, '2020-01-01T00:00:00.000Z')?.getTime()).toBe(new Date(changedAt).getTime() + 90 * DAY)
    })

    describe('over the real REST API', () => {
      const tokenOf = async (u: TestUser) =>
        (await payload.login({ collection: 'users', data: { email: u.email, password: 'test1234' } })).token as string
      const call = async (handler: typeof GET, method: string, path: string, headers: Record<string, string>, body?: unknown) => {
        const response = await handler(
          new Request(`http://localhost/api/${path}`, {
            method,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
          { params: Promise.resolve({ slug: path.split('?')[0].split('/') }) },
        )
        return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> }
      }
      const jwt = async (u: TestUser) => ({ Authorization: `JWT ${await tokenOf(u)}` })

      it('nobody but the platform sets what the price is made of — single, bulk; nor reads it', async () => {
        const { obec, admin } = await makeObec('rest', { population: 21_000 })
        const { admin: otherAdmin } = await makeObec('rest-other', { population: 500 })
        const before = await read(obec.id)
        const forged = {
          population: 10,
          populationYear: 2000,
          contractStart: '2020-01-01T00:00:00.000Z',
          contractYears: 3,
          firstWave: true,
          referenceDiscount: true,
          priceIndexPercent: 0,
          floorExceptionNote: 'self-granted',
          trialEndsAt: '2099-01-01T00:00:00.000Z',
          licenceTier: 0,
          licenceCustomYearlyCzk: 1,
          implementationFeeCzk: 0,
          licenceBilledTier: 0,
          licenceBilledTierPeriod: '2099',
          licenceNextTier: 0,
          licenceNextTierPeriod: '2099',
          trialReminderState: 'x',
        }
        for (const who of [admin, otherAdmin, resident]) {
          const h = await jwt(who)
          await call(PATCH, 'PATCH', `municipalities/${obec.id}`, h, forged)
          await call(PATCH, 'PATCH', 'municipalities?where[id][exists]=true', h, forged)
        }
        const after = await read(obec.id)
        for (const field of Object.keys(forged) as (keyof typeof after)[]) {
          expect(after[field] ?? null, String(field)).toEqual(before[field] ?? null)
        }
        const own = await call(GET, 'GET', `municipalities/${obec.id}`, await jwt(admin))
        for (const field of ['population', 'contractStart', 'firstWave', 'floorExceptionNote', 'trialEndsAt', 'licenceNextTier']) {
          expect(own.json[field], field).toBeUndefined()
        }
        // Not the price list either.
        expect((await call(PATCH, 'PATCH', 'globals/billing-settings', await jwt(admin), { growthCapCzk: 1 })).status).toBeGreaterThanOrEqual(400)
      })

      it('the platform sets the contract within bounds — not the bands the job fixes', async () => {
        const { obec } = await makeObec('rest-platform', { population: 21_000 })
        const h = await jwt(platform)
        expect((await call(PATCH, 'PATCH', `municipalities/${obec.id}`, h, { population: -5 })).status).toBe(400)
        expect((await call(PATCH, 'PATCH', `municipalities/${obec.id}`, h, { priceIndexPercent: 500 })).status).toBe(400)
        expect((await call(PATCH, 'PATCH', `municipalities/${obec.id}`, h, { population: 22_000, contractYears: 3 })).status).toBe(200)
        expect(await read(obec.id)).toMatchObject({ population: 22_000, contractYears: 3 })
        await call(PATCH, 'PATCH', `municipalities/${obec.id}`, h, { licenceBilledTier: 0, licenceNextTier: 0 })
        const stored = await read(obec.id)
        expect(stored.licenceBilledTier ?? null).toBeNull()
        expect(stored.licenceNextTier ?? null).toBeNull()
      })

      it("a user's last activity is noted on a signed-in request — and nobody writes it over the API", async () => {
        const user = await makeUser('seen')
        await payload.db.updateOne({ collection: 'users', id: user.id, data: { lastSeenAt: null } })
        const token = await tokenOf(user)
        await call(GET, 'GET', 'users/me', { Cookie: `${payload.config.cookiePrefix}-token=${token}` })
        await vi.waitFor(async () => {
          const stored = await payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
          expect(stored.lastSeenAt).toBeTruthy()
        })
        await call(PATCH, 'PATCH', `users/${user.id}`, { Cookie: `${payload.config.cookiePrefix}-token=${token}` }, { lastSeenAt: '2000-01-01T00:00:00.000Z' })
        const stored = await payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
        expect(stored.lastSeenAt).not.toBe('2000-01-01T00:00:00.000Z')
      })
    })
  })
})
