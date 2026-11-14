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
  countActiveUsers,
  takeActiveUserSnapshot,
} from '@/lib/billing/active-users'
import {
  catalogFrom,
  cheaperScrapingPackage,
  DEFAULT_CATALOG,
  scrapingYearlyPriceOf,
  tierForPopulation,
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

  it('puts an obec of a number of inhabitants in its band — the open-ended one last', () => {
    const tiers = DEFAULT_CATALOG.licenceTiers
    expect(tierForPopulation(tiers, 0)).toBe(0)
    expect(tierForPopulation(tiers, 999)).toBe(0)
    expect(tierForPopulation(tiers, 1000)).toBe(1)
    expect(tierForPopulation(tiers, 21_000)).toBe(5)
    expect(tierForPopulation(tiers, 99_999)).toBe(6)
    expect(tierForPopulation(tiers, 1_300_000)).toBe(7)
    expect(tierRangeLabel(tiers, 0)).toBe('do 999')
    expect(tierRangeLabel(tiers, 1)).toMatch(/^1\s000 až 1\s999$/)
    expect(tierRangeLabel(tiers, 7)).toMatch(/^100\s000 a víc$/)
    // Ceník 2027.
    expect(tiers.map((t) => t.yearlyPriceCzk)).toEqual([13_200, 19_800, 33_000, 59_400, 85_800, 118_800, 165_000, null])
    expect(tiers.map((t) => t.floorCzk)).toEqual([12_000, 18_000, 30_000, 54_000, 78_000, 108_000, 150_000, 150_000])
    expect(tiers.map((t) => t.implementationFeeCzk)).toEqual([5_000, 5_000, 5_000, 10_000, 10_000, 15_000, 15_000, 15_000])
  })

  it('fills what the stored price list leaves empty with the defaults — and ignores the old bands by users', () => {
    const catalog = catalogFrom({
      smsPackages: { m: { quota: 4000 } },
      licenceTiers: [
        { maxPopulation: null, yearlyPriceCzk: null, floorCzk: 100, implementationFeeCzk: 3 },
        { maxPopulation: 10, yearlyPriceCzk: 2, floorCzk: 1, implementationFeeCzk: 3 },
      ],
    })
    expect(catalog.smsPackages.m).toEqual({ quota: 4000, yearlyPriceCzk: DEFAULT_CATALOG.smsPackages.m.yearlyPriceCzk })
    expect(catalog.smsPackages.s).toEqual(DEFAULT_CATALOG.smsPackages.s)
    // In order, the open-ended one last.
    expect(catalog.licenceTiers.map((t) => t.maxPopulation)).toEqual([10, null])
    expect(catalog.maxInputTokensPerRun).toBe(60_000)
    // A list saved before 1. 11. 2026 (bands by users, no floor) counts for nothing.
    const old = catalogFrom({ licenceTiers: [{ yearlyPriceCzk: 36_000 }, { yearlyPriceCzk: 70_000 }] })
    expect(old.licenceTiers).toEqual(DEFAULT_CATALOG.licenceTiers)
  })

  it('prices loading events by the package alone — no extra source nor twice-weekly surcharge; suggests a smaller package', () => {
    const c = DEFAULT_CATALOG
    expect(scrapingYearlyPriceOf(c, 's')).toBe(5_400)
    expect(scrapingYearlyPriceOf(c, 'm')).toBe(12_000)
    expect(cheaperScrapingPackage(c, 'l', 3)).toBe('s')
    expect(cheaperScrapingPackage(c, 'l', 8)).toBe('m')
    expect(cheaperScrapingPackage(c, 'm', 10)).toBeNull()
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

  it('counts the active users of the obec — home obec, signed in or at an event in 90 days — each once', async () => {
    const now = new Date()
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
    const resident = async (name: string, lastSeenAt: string | null, municipality: number | null = obec.id) => {
      const u = await makeUser(name)
      await payload.create({ collection: 'profiles', data: { user: u.id, fullName: name, municipality } as never, overrideAccess: true })
      if (lastSeenAt) await payload.db.updateOne({ collection: 'users', id: u.id, data: { lastSeenAt } })
      return u
    }
    await resident('seen-recently', daysAgo(5)) // counts
    await resident('seen-long-ago', daysAgo(200)) // doesn't
    const attended = await resident('at-an-event', daysAgo(200)) // counts — at an event 10 days ago
    await resident('elsewhere', daysAgo(1), null) // another home obec: doesn't
    const organizer = await makeUser('organizer-here') // a role here, lives elsewhere: doesn't
    await payload.create({ collection: 'user-roles', data: { user: organizer.id, municipality: obec.id, role: 'organizer' }, overrideAccess: true })
    await payload.db.updateOne({ collection: 'users', id: organizer.id, data: { lastSeenAt: daysAgo(1) } })
    const gone = await resident('deleted', daysAgo(1)) // anonymized: doesn't
    await payload.db.updateOne({ collection: 'users', id: gone.id, data: { anonymizedAt: daysAgo(0) } })

    const category = await payload.create({ collection: 'event-categories', data: { name: `Billing active ${STAMP}` }, overrideAccess: true })
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Active users ${STAMP}`,
        dateTime: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
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
    // Took place 10 days ago (an event can't be created in the past).
    await payload.db.updateOne({ collection: 'events', id: event.id, data: { dateTime: daysAgo(10) } })
    await payload.db.create({
      collection: 'registrations',
      data: { event: event.id, user: attended.id, status: 'approved', role: 'participant', attendanceStatus: 'attended' },
    })
    try {
      expect(await countActiveUsers(payload, obec.id, now)).toBe(2)

      // One snapshot per month — taken again, it's overwritten.
      await takeActiveUserSnapshot(payload, obec.id, now)
      const again = await takeActiveUserSnapshot(payload, obec.id, now, organizer.id)
      expect(again).toMatchObject({ activeUsers: 2, byHand: true })
      const stored = await payload.find({
        collection: 'active-user-snapshots',
        where: { municipality: { equals: obec.id } },
        overrideAccess: true,
      })
      expect(stored.totalDocs).toBe(1)
    } finally {
      await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true })
      await payload.delete({ collection: 'events', id: event.id, overrideAccess: true })
      await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true })
    }
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
    expect(services.licence).toMatchObject({ tier: 2, tierManual: true, yearlyPriceCzk: 33_000 })
    expect(services.sms).toMatchObject({
      enabled: true,
      package: 'm',
      quota: 3600,
      yearlyPriceCzk: 9000,
    })
    expect(services.scraping).toMatchObject({ enabled: true, package: 'l', maxSources: 25 })
    expect(services.yearlyTotalCzk).toBe(33_000 + 9000 + 26_400)

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

  it("puts in the month's overview everything to bill — SMS overage, first set-ups (no surcharge for extra sources nor twice a week) — and the AI cost", async () => {
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
      // 11 switched on — the package has 10, the platform allowed 14: no surcharge (Ceník 2027).
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
        scrapingFrequency: '2× týdně',
        scrapingYearlyCzk: 12_000,
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
