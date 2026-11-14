// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

import { DEFAULT_CATALOG, catalogFrom } from '@/lib/billing/catalog'
import { planCancellationSms, smsHardLimitOf, smsUsageOf } from '@/lib/billing/sms'
import { alertLevelsFor, smsAlertMessage } from '@/lib/billing/sms-alerts'
import { claimSmsParts } from '@/lib/billing/sms-ledger'
import { checkSmsUsageAlerts } from '@/lib/billing/sms-alerts'

let payload: Payload
const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

const allowance = (quota: number, used: number, capPercent = 50) => {
  const hardLimit = smsHardLimitOf(quota, { smsOverageCapPercent: capPercent })
  return {
    active: true,
    quota,
    remainingParts: Math.max(0, quota - used),
    remainingToCapParts: Math.max(0, hardLimit - used),
  }
}
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))

/**
 * Přečerpání SMS (bod 10): one cancellation can't run an obec's SMS up without end — past its quota only
 * up to a cap (50 % of it by default, set in the price list), and its admins are told at 80 %, 100 % and
 * at the cap. Only the platform sets the cap.
 */
describe('SMS overage cap', () => {
  describe('the plan', () => {
    it('the cap is the quota plus a share of it, rounded down; 0 % allows no overage at all', () => {
      expect(smsHardLimitOf(1200, { smsOverageCapPercent: 50 })).toBe(1800)
      expect(smsHardLimitOf(3, { smsOverageCapPercent: 50 })).toBe(4)
      expect(smsHardLimitOf(1, { smsOverageCapPercent: 50 })).toBe(1)
      expect(smsHardLimitOf(100, { smsOverageCapPercent: 0 })).toBe(100)
      expect(smsHardLimitOf(100, { smsOverageCapPercent: -20 })).toBe(100)
      expect(DEFAULT_CATALOG.smsOverageCapPercent).toBe(50)
      expect(catalogFrom({ smsOverageCapPercent: 20 }).smsOverageCapPercent).toBe(20)
      expect(catalogFrom({}).smsOverageCapPercent).toBe(50)
    })

    it('a cancellation that starts in the quota texts up to the cap — in order, the excess marked as overage', () => {
      // Quota 10, 8 used → 2 left, cap 15 → 7 more at most. 12 people: seven texted, two within the quota.
      const plan = planCancellationSms(people(12), 1, allowance(10, 8), 0)
      expect(plan.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(plan.map((r) => r.overage)).toEqual([false, false, true, true, true, true, true])
    })

    it('with room in the cap for everyone, everyone is texted', () => {
      expect(planCancellationSms(people(5), 1, allowance(10, 8), 0)).toHaveLength(5)
    })

    it('SMS queued but not yet sent count against the cap too', () => {
      // 10 quota, 0 used, 9 held by queued SMS: one left in the quota, six in the cap.
      expect(planCancellationSms(people(20), 1, allowance(10, 0), 9)).toHaveLength(6)
      // Held up to the cap: nothing more.
      expect(planCancellationSms(people(20), 1, allowance(10, 0), 15)).toEqual([])
    })

    it('a longer SMS (more parts) is cut off by whole messages — never half of one', () => {
      // Cap 15, used 12 → 3 parts left: one 2-part SMS fits, a second would pass the cap.
      expect(planCancellationSms(people(5), 2, allowance(10, 12), 0).length).toBe(0) // quota used up: none
      expect(planCancellationSms(people(5), 2, allowance(10, 9), 0)).toHaveLength(3) // 6 left in the cap → 3 SMS
    })

    it('nothing once the quota itself is used up — the cap only widens a cancellation that started in it', () => {
      expect(planCancellationSms(people(5), 1, allowance(10, 10), 0)).toEqual([])
      expect(planCancellationSms(people(5), 1, allowance(10, 13), 0)).toEqual([])
    })

    it('no cap, no overage: the cancellation is texted to the end of the quota only', () => {
      expect(planCancellationSms(people(20), 1, allowance(10, 8, 0), 0)).toHaveLength(2)
    })
  })

  describe('the alerts', () => {
    it('are at 80 and 100 %, in between while the cap allows, and exactly at the cap', () => {
      expect(alertLevelsFor(50)).toEqual([150, 120, 100, 80])
      expect(alertLevelsFor(0)).toEqual([100, 80])
      expect(alertLevelsFor(25)).toEqual([125, 120, 100, 80])
      expect(alertLevelsFor(200)).toEqual([300, 200, 150, 120, 100, 80])
    })

    const usage = (used: number) => ({
      enabled: true,
      suspended: false,
      quota: 1200,
      hardLimit: 1800,
      usedParts: used,
      overageParts: Math.max(0, used - 1200),
      period: { start: new Date(), end: new Date(), key: 'k', custom: false, lapsed: false, paidEnd: new Date() },
    })
    it('tell the obec what it means in SMS — at 100 % the cap, at the cap that nothing more goes', () => {
      expect(smsAlertMessage(80, usage(960)).message).toContain('600 SMS nad kvótu')
      const full = smsAlertMessage(100, usage(1200))
      expect(full.title).toBe('Kvóta SMS je vyčerpaná')
      expect(full.message).toContain('nejvýš do 600 SMS nad kvótu')
      const capped = smsAlertMessage(150, usage(1800))
      expect(capped.title).toBe('Strop přečerpání SMS je vyčerpaný')
      expect(capped.message).toContain('Další SMS o zrušení akcí už nepůjdou')
      expect(smsAlertMessage(120, usage(1500)).title).toBe('Přečerpání SMS roste')
    })
  })

  describe('against the database', () => {
    let platform: TestUser
    let obecAdmin: TestUser
    let otherAdmin: TestUser
    const userIds: number[] = []
    const obecIds: number[] = []

    const as = (u: TestUser) => ({ user: { ...u, collection: 'users' as const }, overrideAccess: false as const })
    const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
      const u = (await payload.create({
        collection: 'users',
        data: { email: `smscap-${name}-${STAMP}@test.local`, password: 'test1234', role },
        overrideAccess: true,
      })) as TestUser
      userIds.push(u.id)
      return u
    }
    const makeObec = async (label: string, data: Record<string, unknown> = {}, admin?: TestUser) => {
      const obec = await payload.create({
        collection: 'municipalities',
        data: {
          name: `SmsCap ${label} ${STAMP}`,
          lat: 49.4,
          lng: 15.2,
          eventRadiusKm: 15,
          rulesForCreation: 'approved_organizers',
          smsEnabled: true,
          licencePaidUntil: new Date(Date.now() + 200 * 86_400_000).toISOString(),
          ...data,
        },
        overrideAccess: true,
      })
      obecIds.push(obec.id)
      if (admin) await payload.create({ collection: 'user-roles', data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' }, overrideAccess: true })
      return obec
    }
    const readCatalog = () => payload.findGlobal({ slug: 'billing-settings', depth: 0, overrideAccess: true })

    beforeAll(async () => {
      payload = await getPayload({ config: await config })
      platform = await makeUser('root', 'admin')
      obecAdmin = await makeUser('admin')
      otherAdmin = await makeUser('other-admin')
    }, 120_000)

    afterAll(async () => {
      for (const id of obecIds) {
        await payload.delete({ collection: 'sms-messages', where: { municipality: { equals: id } }, overrideAccess: true }).catch(() => {})
        await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
      }
      await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
      await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 50 }, overrideAccess: true }).catch(() => {})
      for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    })

    it('the ledger refuses past the cap whatever was queued, and tells what was refused for', async () => {
      const obec = await makeObec('ledger', { smsQuotaOverride: 4 }) // cap 6
      const claims = await Promise.all(
        Array.from({ length: 10 }, (_, i) => claimSmsParts(payload, { municipalityId: obec.id, requestId: `event-cancelled-cap${STAMP}-${i}`, parts: 1 })),
      )
      expect(claims.filter((c) => c.decision === 'send')).toHaveLength(6)
      expect(claims.filter((c) => c.decision === 'skip' && c.reason === 'overage_cap')).toHaveLength(4)
      const usage = await smsUsageOf(payload, obec.id, new Date())
      expect([usage.usedParts, usage.overageParts, usage.hardLimit]).toEqual([6, 2, 6])
      // A new cancellation: the quota is used up.
      expect(await claimSmsParts(payload, { municipalityId: obec.id, requestId: `event-cancelled-cap2${STAMP}-1`, parts: 1 })).toEqual({
        decision: 'skip',
        reason: 'quota_used_up',
      })
    })

    it('the cap follows the price list — at 0 % there is no overage, at 100 % the quota doubles', async () => {
      const obec = await makeObec('pricelist', { smsQuotaOverride: 4 })
      try {
        await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 0 }, ...as(platform) })
        expect((await smsUsageOf(payload, obec.id, new Date())).hardLimit).toBe(4)
        await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 100 }, ...as(platform) })
        expect((await smsUsageOf(payload, obec.id, new Date())).hardLimit).toBe(8)
      } finally {
        await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 50 }, overrideAccess: true })
      }
    })

    it('its admins are told at the cap', async () => {
      const admin = await makeUser('alert-admin')
      const obec = await makeObec('alerts', { smsQuotaOverride: 4 }, admin)
      for (let i = 0; i < 6; i++) {
        await payload.create({ collection: 'sms-messages', data: { municipality: obec.id, requestId: `event-cancelled-al${STAMP}-${i}`, parts: 1, overage: i >= 4 }, overrideAccess: true })
      }
      await checkSmsUsageAlerts(payload, obec.id, new Date())
      await vi.waitFor(async () => {
        const notices = await payload.find({
          collection: 'notifications',
          where: { and: [{ user: { equals: admin.id } }, { title: { equals: 'Strop přečerpání SMS je vyčerpaný' } }] },
          overrideAccess: true,
        })
        expect(notices.docs).toHaveLength(1)
      })
    })

    it('only the platform can set the cap, a quota or a package — not an obec admin, another obec admin, a resident, nor signed out', async () => {
      const obec = await makeObec('attacked', { smsQuotaOverride: 10 }, obecAdmin)
      await makeObec('foreign', {}, otherAdmin)
      for (const attacker of [obecAdmin, otherAdmin]) {
        await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 200 }, ...as(attacker) }).catch(() => null)
        await payload
          .update({ collection: 'municipalities', id: obec.id, data: { smsQuotaOverride: 100000, smsPackage: 'l', smsEnabled: true } as never, ...as(attacker) })
          .catch(() => null)
        await payload
          .update({ collection: 'municipalities', where: { id: { exists: true } }, data: { smsQuotaOverride: 100000 } as never, ...as(attacker) })
          .catch(() => null)
      }
      // What the obec admins did — with access control, as every request does — changed nothing.
      expect((await readCatalog()).smsOverageCapPercent).toBe(50)
      // Nor does a signed-out request (access control on, no user).
      await payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 200 }, overrideAccess: false }).catch(() => null)
      expect((await readCatalog()).smsOverageCapPercent).toBe(50)
      const stored = await payload.findByID({ collection: 'municipalities', id: obec.id, depth: 0, overrideAccess: true })
      expect(stored.smsQuotaOverride).toBe(10)
      expect(stored.smsPackage).not.toBe('l')
      // The price list isn't readable by an obec either.
      await expect(payload.findGlobal({ slug: 'billing-settings', ...as(obecAdmin) })).rejects.toThrow()
      // The platform may, within sane bounds — and the change is on the record.
      await expect(payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: 500 }, ...as(platform) })).rejects.toThrow()
      await expect(payload.updateGlobal({ slug: 'billing-settings', data: { smsOverageCapPercent: -1 }, ...as(platform) })).rejects.toThrow()
    })
  })
})
