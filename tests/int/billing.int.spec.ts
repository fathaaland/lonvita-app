// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueImportEvents: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
}))

import { enqueueImportEvents } from '@/lib/queue/queues'
import {
  computedTierOf,
  countActiveUsers,
  takeActiveUserSnapshot,
} from '@/lib/billing/active-users'
import {
  catalogFrom,
  cheaperScrapingPackage,
  DEFAULT_CATALOG,
  scrapingYearlyPriceOf,
  tierForUsers,
  tierRangeLabel,
} from '@/lib/billing/catalog'
import { licencePeriodOf, pragueMonthKey } from '@/lib/billing/period'
import { billingCsv, billingRowsFor } from '@/lib/billing/report'
import { checkScrapingCost } from '@/lib/billing/scraping-cost'
import { getMunicipalityServices, withoutPrices } from '@/lib/services/municipality-services'

import {
  isObecSlot,
  processScanEventSourcesJob,
} from '../../worker/src/processors/scan-event-sources.processor'

let payload: Payload
const STAMP = Date.now()

describe('Billing — licence bands, packages and the superadmin overview', () => {
  let obec: { id: number }
  const userIds: number[] = []

  const makeUser = async (name: string) => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `billing-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    userIds.push(user.id)
    return user
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    obec = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Billing obec ${STAMP}`,
        lat: 49.4,
        lng: 15.2,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload
      .delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: obec.id, overrideAccess: true })
      .catch(() => {})
    for (const id of userIds) {
      await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    }
  })

  it('puts a number of users in its band — the open-ended one last', () => {
    const tiers = DEFAULT_CATALOG.licenceTiers
    expect(tierForUsers(tiers, 0)).toBe(0)
    expect(tierForUsers(tiers, 100)).toBe(0)
    expect(tierForUsers(tiers, 101)).toBe(1)
    expect(tierForUsers(tiers, 1500)).toBe(7)
    expect(tierForUsers(tiers, 99_999)).toBe(8)
    expect(tierRangeLabel(tiers, 1)).toBe('101 až 300')
    expect(tierRangeLabel(tiers, 8)).toMatch(/^1\s501 a víc$/)
  })

  it('averages the last three snapshots — without any, the users it has now', () => {
    const tiers = DEFAULT_CATALOG.licenceTiers
    const snap = (activeUsers: number) => ({
      month: '2026-01',
      activeUsers,
      takenAt: '',
      byHand: false,
    })
    expect(computedTierOf(tiers, [], 250)).toEqual({ averageUsers: 250, tier: 1, fromSnapshots: 0 })
    // The fourth (oldest) doesn't count.
    expect(computedTierOf(tiers, [snap(90), snap(110), snap(100), snap(5000)], 0)).toMatchObject({
      averageUsers: 100,
      tier: 0,
      fromSnapshots: 3,
    })
  })

  it('fills what the stored price list leaves empty with the defaults', () => {
    const catalog = catalogFrom({
      smsPackages: { m: { quota: 4000 } },
      licenceTiers: [
        { maxUsers: null, yearlyPriceCzk: 1 },
        { maxUsers: 10, yearlyPriceCzk: 2 },
      ],
    })
    expect(catalog.smsPackages.m).toEqual({
      quota: 4000,
      yearlyPriceCzk: DEFAULT_CATALOG.smsPackages.m.yearlyPriceCzk,
    })
    expect(catalog.smsPackages.s).toEqual(DEFAULT_CATALOG.smsPackages.s)
    // Sorted, the open-ended band last.
    expect(catalog.licenceTiers.map((t) => t.maxUsers)).toEqual([10, null])
    expect(catalog.maxInputTokensPerRun).toBe(60_000)
  })

  it('prices all of scraping it is given: the package, every switched-on source past it, and reading twice a week', () => {
    const c = DEFAULT_CATALOG
    // M: 10 sources. Twelve and twice a week: 12 000 + 2 × 1 500 + 2 400.
    expect(scrapingYearlyPriceOf(c, 'm', 12, 'twice_weekly')).toEqual({
      packageCzk: 12_000,
      extraSources: 2,
      extraSourcesCzk: 3_000,
      frequencyCzk: 2_400,
      totalCzk: 17_400,
    })
    // A limit set below the package's is no discount.
    expect(scrapingYearlyPriceOf(c, 'm', 4, 'weekly').totalCzk).toBe(12_000)
    // S with ten extra (13 sources): 5 400 + 15 000 = 20 400 — L gives 25 for 26 400, M with 3 extra
    // 12 000 + 4 500 = 16 500: the cheaper deal is pointed out.
    expect(cheaperScrapingPackage(c, 's', 13, 'weekly')).toBe('m')
    expect(cheaperScrapingPackage(c, 'm', 10, 'weekly')).toBeNull()
    expect(catalogFrom({ scrapingExtraSourcePriceCzk: 900 }).scrapingExtraSourcePriceCzk).toBe(900)
  })

  it('repeats a set licence period once it is over — the SMS never fall outside every period', () => {
    const set = { licencePeriodStart: '2025-07-01T00:00:00.000Z', licencePeriodEnd: '2026-07-01T00:00:00.000Z' }
    const now = licencePeriodOf(set, new Date('2026-11-12T10:00:00Z'))
    expect([now.start.toISOString(), now.end.toISOString()]).toEqual(['2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'])
    expect(now.key).toBe('2026-07-01')
    // Years later, and before it began, too.
    expect(licencePeriodOf(set, new Date('2031-01-05T00:00:00Z')).start.toISOString()).toBe('2030-07-01T00:00:00.000Z')
    expect(licencePeriodOf(set, new Date('2024-12-31T00:00:00Z')).start.toISOString()).toBe('2024-07-01T00:00:00.000Z')
    // On the boundary the new one has begun.
    expect(licencePeriodOf(set, new Date('2026-07-01T00:00:00Z')).start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    // A month-end start keeps to month ends, without drifting.
    const monthEnd = { licencePeriodStart: '2025-01-31T00:00:00.000Z', licencePeriodEnd: '2025-02-28T00:00:00.000Z' }
    expect(licencePeriodOf(monthEnd, new Date('2025-05-15T00:00:00Z')).start.toISOString()).toBe('2025-04-30T00:00:00.000Z')
    // A start alone is a year.
    expect(licencePeriodOf({ licencePeriodStart: '2025-03-01T00:00:00.000Z' }, new Date('2027-03-02T00:00:00Z')).start.toISOString()).toBe(
      '2027-03-01T00:00:00.000Z',
    )
  })

  it('counts every registered user of the obec once — home obec or a role, however many roles', async () => {
    const resident = await makeUser('resident')
    const organizer = await makeUser('organizer')
    await makeUser('outsider')
    await payload.create({
      collection: 'profiles',
      data: { user: resident.id, fullName: 'Billing resident', municipality: obec.id },
      overrideAccess: true,
    })
    // Lives elsewhere, but holds two roles here — still one user.
    for (const role of ['organizer', 'municipality_admin'] as const) {
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: obec.id, role },
        overrideAccess: true,
      })
    }
    expect(await countActiveUsers(payload, obec.id)).toBe(2)

    // One snapshot per month — taken again, it's overwritten.
    const now = new Date('2026-11-15T10:00:00Z')
    await takeActiveUserSnapshot(payload, obec.id, now)
    const again = await takeActiveUserSnapshot(payload, obec.id, now, organizer.id)
    expect(again).toMatchObject({ month: '2026-11', activeUsers: 2, byHand: true })
    const stored = await payload.find({
      collection: 'active-user-snapshots',
      where: { municipality: { equals: obec.id } },
      overrideAccess: true,
    })
    expect(stored.totalDocs).toBe(1)
  })

  it('counts the SMS quota within the licence period — the calendar year unless set', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    const calendar = licencePeriodOf({}, now)
    expect(calendar.custom).toBe(false)
    expect(calendar.start.toISOString()).toBe('2025-12-31T23:00:00.000Z')
    const custom = licencePeriodOf({ licencePeriodStart: '2026-03-01T00:00:00.000Z' }, now)
    expect(custom.custom).toBe(true)
    expect(custom.end.toISOString()).toBe('2027-03-01T00:00:00.000Z')
  })

  it('shows the obec its packages and use without any price — the platform with them', async () => {
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: {
        smsEnabled: true,
        smsPackage: 'm',
        importAiEnabled: true,
        scrapingPackage: 'l',
        licenceTier: 2,
      },
      overrideAccess: true,
    })
    const services = await getMunicipalityServices(payload, obec.id, new Date())
    expect(services.licence).toMatchObject({ tier: 2, tierManual: true, yearlyPriceCzk: 100_000 })
    expect(services.sms).toMatchObject({
      enabled: true,
      package: 'm',
      quota: 3600,
      yearlyPriceCzk: 9000,
    })
    expect(services.scraping).toMatchObject({ enabled: true, package: 'l', maxSources: 25 })
    expect(services.yearlyTotalCzk).toBe(100_000 + 9000 + 26_400)

    const forObec = withoutPrices(services)
    expect(forObec.yearlyTotalCzk).toBeNull()
    expect(forObec.licence.yearlyPriceCzk).toBeNull()
    expect(forObec.sms.yearlyPriceCzk).toBeNull()
    expect(forObec.scraping.yearlyPriceCzk).toBeNull()
    expect(forObec.sms.quota).toBe(3600)
  })

  it("an obec's package fields stay the platform's — its own admin can neither read nor change them", async () => {
    const admin = await makeUser('obec-admin')
    await payload.create({
      collection: 'user-roles',
      data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    const asAdmin = await payload.findByID({
      collection: 'municipalities',
      id: obec.id,
      user: admin,
      overrideAccess: false,
    })
    expect(asAdmin.licenceTier).toBeUndefined()
    expect(asAdmin.billingStatus).toBeUndefined()
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { smsPackage: 'l', billingStatus: 'active', licenceTier: 0 },
      user: admin,
      overrideAccess: false,
    })
    const after = await payload.findByID({
      collection: 'municipalities',
      id: obec.id,
      overrideAccess: true,
    })
    expect(after.smsPackage).toBe('m')
    expect(after.licenceTier).toBe(2)
  })

  it('writes who changed the package and how into the audit log', async () => {
    const platformAdmin = await payload.create({
      collection: 'users',
      data: { email: `billing-root-${STAMP}@test.local`, password: 'test1234', role: 'admin' },
      overrideAccess: true,
    })
    userIds.push(platformAdmin.id)
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { billingStatus: 'suspended' },
      user: platformAdmin,
      overrideAccess: false,
    })
    await vi.waitFor(async () => {
      const entries = await payload.find({
        collection: 'audit-log',
        where: {
          and: [
            { action: { equals: 'municipalities.billing-change' } },
            { targetId: { equals: String(obec.id) } },
          ],
        },
        overrideAccess: true,
      })
      expect(entries.docs[0]?.metadata).toMatchObject({
        changes: { billingStatus: { from: 'active', to: 'suspended' } },
      })
    })
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { billingStatus: 'active' },
      overrideAccess: true,
    })
  })

  it('a suspended obec reads as without SMS and import to anyone but the platform — its packages kept', async () => {
    const resident = await makeUser('reader')
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { smsEnabled: true, importAiEnabled: true, billingStatus: 'suspended' },
      overrideAccess: true,
    })
    const asResident = await payload.findByID({
      collection: 'municipalities',
      id: obec.id,
      user: resident,
      overrideAccess: false,
    })
    expect(asResident.smsEnabled).toBe(false)
    expect(asResident.importAiEnabled).toBe(false)
    // The worker writes to it meanwhile (no user) — what's hidden isn't written back.
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { smsAlertState: 'x|80' },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { billingStatus: 'active' },
      overrideAccess: true,
    })
    const restored = await payload.findByID({
      collection: 'municipalities',
      id: obec.id,
      user: resident,
      overrideAccess: false,
    })
    expect(restored.smsEnabled).toBe(true)
    expect(restored.importAiEnabled).toBe(true)
  })

  it("reads an obec's sources in its weekly slot only — and a suspended one's never", async () => {
    // Monday 2. 11. 2026, 9:30 in Prague (CET).
    const mondayNine = new Date('2026-11-02T08:30:00Z')
    expect(isObecSlot({ scrapingSlotDay: 1, scrapingSlotHour: 9 }, mondayNine)).toBe(true)
    expect(isObecSlot({ scrapingSlotDay: 1, scrapingSlotHour: 10 }, mondayNine)).toBe(false)
    expect(isObecSlot({ scrapingSlotDay: 2, scrapingSlotHour: 9 }, mondayNine)).toBe(false)
    // Twice a week: the slot day and three days later (Friday → Monday).
    expect(
      isObecSlot(
        { scrapingSlotDay: 5, scrapingSlotHour: 9, scrapingFrequency: 'twice_weekly' },
        mondayNine,
      ),
    ).toBe(true)

    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: {
        importAiEnabled: true,
        scrapingSlotDay: 1,
        scrapingSlotHour: 9,
        scrapingMaxSourcesOverride: 5,
      },
      overrideAccess: true,
    })
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: `https://slot-${STAMP}.cz/akce` },
      overrideAccess: true,
    })
    vi.mocked(enqueueImportEvents).mockClear()
    await processScanEventSourcesJob({}, mondayNine)
    expect(vi.mocked(enqueueImportEvents)).toHaveBeenCalledWith(
      { kind: 'source', sourceId: source.id, trigger: 'weekly' },
      expect.objectContaining({ jobId: `import-source-${source.id}-2026-11-02` }),
    )

    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { billingStatus: 'suspended' },
      overrideAccess: true,
    })
    vi.mocked(enqueueImportEvents).mockClear()
    await processScanEventSourcesJob({}, mondayNine)
    expect(
      vi
        .mocked(enqueueImportEvents)
        .mock.calls.some(([data]) => 'sourceId' in data && data.sourceId === source.id),
    ).toBe(false)
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { billingStatus: 'active' },
      overrideAccess: true,
    })
    await payload.delete({ collection: 'event-sources', id: source.id, overrideAccess: true })
  })

  it('catches up a source whose slot went by unread (the worker was down that hour)', async () => {
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: { importAiEnabled: true, billingStatus: 'active', scrapingSlotDay: 1, scrapingSlotHour: 3 },
      overrideAccess: true,
    })
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: `https://catch-up-${STAMP}.cz/akce` },
      overrideAccess: true,
    })
    // A Tuesday morning (not the slot, which is 3:00) at least two days from now — a new source is
    // marked as queued with the real clock, and a fixed date in the past would count that mark as
    // fresh (younger than six hours before "now"), so the source would never look overdue. Last read
    // 8 days before it.
    const tuesday = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    tuesday.setUTCHours(8, 30, 0, 0)
    while (tuesday.getUTCDay() !== 2) tuesday.setUTCDate(tuesday.getUTCDate() + 1)
    await payload.db.updateOne({
      collection: 'event-sources',
      id: source.id,
      data: { lastRunAt: new Date(tuesday.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() },
    })
    const queuedFor = () =>
      vi.mocked(enqueueImportEvents).mock.calls.some(([data]) => 'sourceId' in data && data.sourceId === source.id)
    vi.mocked(enqueueImportEvents).mockClear()
    await processScanEventSourcesJob({}, tuesday)
    expect(queuedFor()).toBe(true)

    // Read two days ago: nothing missed, nothing to catch up.
    await payload.db.updateOne({
      collection: 'event-sources',
      id: source.id,
      data: { lastRunAt: new Date(tuesday.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    })
    vi.mocked(enqueueImportEvents).mockClear()
    await processScanEventSourcesJob({}, tuesday)
    expect(queuedFor()).toBe(false)
    await payload.delete({ collection: 'event-sources', id: source.id, overrideAccess: true })
  })

  it("puts every obec in the month's overview and its CSV — opened by Czech Excel, no formulas", async () => {
    const rows = await billingRowsFor(payload, '2026-11', new Date('2026-11-15T10:00:00Z'))
    const row = rows.find((r) => r.municipalityId === obec.id)
    expect(row).toMatchObject({ snapshotUsers: 2, smsPackage: 'M', scrapingPackage: 'L' })

    const csv = billingCsv([{ ...row!, name: '=HYPERLINK("x")' }])
    expect(csv.startsWith('﻿Obec;Stav;')).toBe(true)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it("puts in the month's overview everything to bill — switched-on extra sources, twice a week, SMS overage, first set-ups — and the AI cost", async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Billing items ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers',
        smsEnabled: true, importAiEnabled: true, scrapingPackage: 'm', scrapingMaxSourcesOverride: 14, scrapingFrequency: 'twice_weekly',
      } as never,
      overrideAccess: true,
    })
    const url = (i: number) => `https://items-${STAMP}-${i}.cz/akce`
    const setUpEntries = async () =>
      (
        await payload.count({
          collection: 'audit-log',
          where: { and: [{ action: { equals: 'event-sources.create' } }, { municipality: { equals: fresh.id } }] },
          overrideAccess: true,
        })
      ).totalDocs
    const waitForEntries = async (n: number) => {
      for (let i = 0; i < 50 && (await setUpEntries()) < n; i++) await new Promise((r) => setTimeout(r, 100))
    }
    try {
      await payload.create({ collection: 'sms-messages', data: { municipality: fresh.id, parts: 3, overage: true }, overrideAccess: true })
      // 11 switched on — the package has 10, the obec may have 14: one extra is billed, not four.
      const sources = []
      for (let i = 0; i < 11; i++) {
        sources.push(await payload.create({ collection: 'event-sources', data: { municipality: fresh.id, url: url(i) }, overrideAccess: true }))
      }
      // One deleted and added again — set up once, billed once.
      await payload.delete({ collection: 'event-sources', id: sources[0].id, overrideAccess: true })
      await payload.create({ collection: 'event-sources', data: { municipality: fresh.id, url: url(0) }, overrideAccess: true })
      await waitForEntries(12)
      // One set up already last year: taken down and set up again this month — no fee again.
      await payload.create({
        collection: 'audit-log',
        data: {
          action: 'event-sources.create', targetCollection: 'event-sources', targetId: 'old',
          municipality: fresh.id, metadata: { url: `https://old-${STAMP}.cz/akce` }, createdAt: '2025-03-01T10:00:00.000Z',
        } as never,
        overrideAccess: true,
      })
      const oldAgain = await payload.create({
        collection: 'event-sources',
        data: { municipality: fresh.id, url: `https://old-${STAMP}.cz/akce`, enabled: false },
        overrideAccess: true,
      })
      await waitForEntries(14)
      expect(oldAgain.enabled).toBe(false)
      await payload.create({
        collection: 'usage-events',
        data: {
          municipality: fresh.id, provider: 'anthropic', model: 'claude-haiku-5-5', operationType: 'event_import',
          source: 'worker', usageKind: 'tokens', status: 'success', costUsd: 0.04,
        } as never,
        overrideAccess: true,
      })
      const now = new Date()
      const rows = await billingRowsFor(payload, pragueMonthKey(now), now)
      expect(rows.find((r) => r.municipalityId === fresh.id)).toMatchObject({
        enabledSources: 11,
        maxSources: 14,
        extraSources: 1,
        scrapingFrequency: '2× týdně',
        scrapingYearlyCzk: 12_000 + 1_500 + 2_400,
        smsOveragePartsMonth: 3,
        smsOverageCzkMonth: 7.5,
        sourcesSetUpMonth: 11,
        sourceSetupCzkMonth: 11 * 500,
        aiCostUsdMonth: 0.04,
      })
    } finally {
      await payload.delete({ collection: 'event-sources', where: { municipality: { equals: fresh.id } }, overrideAccess: true })
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('tells the platform once a month when an obec\'s AI cost passes its threshold — and blocks nothing', async () => {
    const platform = await makeUser('platform-cost')
    await payload.update({ collection: 'users', id: platform.id, data: { role: 'admin' }, overrideAccess: true })
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Billing cost ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', importAiEnabled: true, scrapingPackage: 's' } as never,
      overrideAccess: true,
    })
    const alerts = async () =>
      (
        await payload.find({
          collection: 'notifications',
          where: { and: [{ user: { equals: platform.id } }, { link: { equals: `/superadmin/obce/${fresh.id}` } }] },
          overrideAccess: true,
        })
      ).totalDocs
    const spend = (costUsd: number) =>
      payload.create({
        collection: 'usage-events',
        data: {
          municipality: fresh.id, provider: 'anthropic', model: 'claude-haiku-5-5', operationType: 'event_import',
          source: 'worker', usageKind: 'tokens', status: 'success', costUsd,
        } as never,
        overrideAccess: true,
      })
    try {
      // S: 3 sources × $0.5 = $1.5 a month.
      await spend(1)
      await checkScrapingCost(payload, fresh.id, new Date())
      expect(await alerts()).toBe(0)
      await spend(1)
      await checkScrapingCost(payload, fresh.id, new Date())
      await checkScrapingCost(payload, fresh.id, new Date())
      expect(await alerts()).toBe(1)
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })
})
