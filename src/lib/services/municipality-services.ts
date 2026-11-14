import type { Payload } from 'payload'

import type { Municipality } from '@/payload-types'
import { countActiveUsers } from '@/lib/billing/active-users'
import {
  cheaperScrapingPackage,
  getBillingCatalog,
  isPackageKey,
  scrapingYearlyPriceOf,
  tierRangeLabel,
  type PackageKey,
} from '@/lib/billing/catalog'
import { licenceQuote } from '@/lib/billing/licence-price'
import { licencePeriodOf } from '@/lib/billing/period'
import { billingStatusOf, nextBillingStepAt, type BillingStatus } from '@/lib/billing/status'
import { scrapingLimitsOf } from '@/lib/billing/scraping'
import { countSmsParts, smsHardLimitOf, smsQuotaOf } from '@/lib/billing/sms'

/**
 * What the obec has bought and how much of it it used (Ceník 2027, lib/billing): the yearly licence by
 * the band of its inhabitants (plus the growth band), the SMS package (a yearly quota of parts) and the
 * package for loading events (a number of sources). E-mails come with the licence. The platform sees
 * the prices and the contract; the obec only its packages and use (withoutPrices).
 */
export type MunicipalityServices = {
  billingStatus: BillingStatus
  /** When it last changed, and when it moves on by itself (suspended → read-only). */
  billingStatusChangedAt: string | null
  billingNextStepAt: string | null
  licence: {
    periodStart: string
    periodEnd: string
    /** Set by the platform rather than the calendar year. */
    periodCustom: boolean
    /** Paid up to (not including) — past it the year doesn't turn, no new SMS quota. */
    paidUntil: string | null
    lapsed: boolean
    /** Inhabitants (ČSÚ) the band is by, and of which year; null until the platform enters them. */
    population: number | null
    populationYear: number | null
    /** Active users now (lib/billing/active-users — signed in or at an event in 90 days). */
    activeUsers: number
    /** Of them in the price (activeUsersIncludedPercent of the inhabitants); null without inhabitants. */
    includedUsers: number | null
    /** The band by size; null without inhabitants. */
    baseTier: number | null
    /** The band it's billed by this year (by hand, or fixed for the year incl. the growth band). */
    tier: number | null
    tierManual: boolean
    tierFixedForYear: boolean
    /** Bands over its size this year. */
    growthSteps: number
    /** The next licence year's band, if the autumn decided it already. */
    nextTier: number | null
    tierRange: string | null
    nextTierRange: string | null
    inTrial: boolean
    trialEndsAt: string | null
    // — the platform's only (withoutPrices) —
    yearlyPriceCzk: number | null
    listPriceCzk: number | null
    floorCzk: number | null
    belowFloor: boolean
    customPrice: boolean
    implementationFeeCzk: number | null
    contractYear: number | null
    /** What's missing for a price (e.g. the inhabitants) — for the platform. */
    missing: string[]
  }
  sms: {
    enabled: boolean
    package: PackageKey
    quota: number
    /** The most it may send — the quota plus the overage cap (lib/billing/sms smsHardLimitOf). */
    hardLimit: number
    usedParts: number
    overageParts: number
    yearlyPriceCzk: number | null
    overagePriceCzk: number | null
  }
  scraping: {
    enabled: boolean
    package: PackageKey
    maxSources: number
    enabledSources: number
    totalSources: number
    slotDay: number
    slotHour: number
    frequency: 'weekly' | 'twice_weekly'
    maxInputTokensPerRun: number
    /** What the package itself allows (the platform may allow more, at no extra price). */
    packageMaxSources: number
    yearlyPriceCzk: number | null
    /** The first wave's first year — package S free. */
    freeThisYear: boolean
    setupFeeCzk: number | null
    /** A smaller package that would cover its sources — a hint for the platform, never for the obec. */
    cheaperPackage: PackageKey | null
  }
  /** Licence + the add-ons it has on, a year — none for the obec's own view. */
  yearlyTotalCzk: number | null
}

type BillingDoc = Pick<
  Municipality,
  | 'billingStatus'
  | 'billingStatusChangedAt'
  | 'licencePeriodStart'
  | 'licencePeriodEnd'
  | 'licencePaidUntil'
  | 'licenceTier'
  | 'licenceBilledTier'
  | 'licenceBilledTierPeriod'
  | 'licenceNextTier'
  | 'licenceNextTierPeriod'
  | 'licenceCustomYearlyCzk'
  | 'implementationFeeCzk'
  | 'population'
  | 'populationYear'
  | 'contractStart'
  | 'contractYears'
  | 'firstWave'
  | 'referenceDiscount'
  | 'priceIndexPercent'
  | 'floorExceptionNote'
  | 'trialEndsAt'
  | 'smsEnabled'
  | 'smsPackage'
  | 'smsQuotaOverride'
  | 'importAiEnabled'
  | 'scrapingSlotDay'
  | 'scrapingSlotHour'
  | 'scrapingFrequency'
>

export async function getMunicipalityServices(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<MunicipalityServices> {
  const catalog = await getBillingCatalog(payload)
  const m = (await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
  })) as BillingDoc
  const period = licencePeriodOf(m, now)
  const [activeUsers, smsUsed, scraping, sources] = await Promise.all([
    countActiveUsers(payload, municipalityId, now),
    countSmsParts(payload, municipalityId, period.start, period.end),
    scrapingLimitsOf(payload, municipalityId, { catalog }),
    payload.find({
      collection: 'event-sources',
      where: { and: [{ municipality: { equals: municipalityId } }, { organization: { exists: false } }] },
      select: { enabled: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])

  const tiers = catalog.licenceTiers
  const quote = licenceQuote(catalog, m, period, now)
  const nextPeriodKey = licencePeriodOf({ ...m, licencePaidUntil: null }, period.paidEnd).key
  const nextTier = m.licenceNextTierPeriod === nextPeriodKey && m.licenceNextTier != null ? m.licenceNextTier : null
  const population = typeof m.population === 'number' ? m.population : null
  const smsPackage = isPackageKey(m.smsPackage) ? m.smsPackage : 's'
  const smsEnabled = m.smsEnabled === true
  const smsPrice = catalog.smsPackages[smsPackage].yearlyPriceCzk
  const frequency = m.scrapingFrequency === 'twice_weekly' ? 'twice_weekly' : 'weekly'
  const enabledSources = sources.docs.filter((s) => s.enabled).length
  const scrapingFree = quote.scrapingSFree && scraping.package === 's'
  const scrapingPrice = scrapingFree ? 0 : scrapingYearlyPriceOf(catalog, scraping.package)

  return {
    billingStatus: billingStatusOf(m.billingStatus),
    billingStatusChangedAt: m.billingStatusChangedAt ?? null,
    billingNextStepAt: nextBillingStepAt(m.billingStatus, m.billingStatusChangedAt, m.trialEndsAt)?.toISOString() ?? null,
    licence: {
      periodStart: period.start.toISOString(),
      periodEnd: period.paidEnd.toISOString(),
      periodCustom: period.custom,
      paidUntil: m.licencePaidUntil ?? null,
      lapsed: period.lapsed,
      population,
      populationYear: m.populationYear ?? null,
      activeUsers,
      includedUsers: population === null ? null : Math.floor((population * catalog.activeUsersIncludedPercent) / 100),
      baseTier: quote.baseTier,
      tier: quote.tier,
      tierManual: quote.tierManual,
      tierFixedForYear: quote.tierFixedForYear,
      growthSteps: quote.growthSteps,
      nextTier,
      tierRange: quote.tier === null ? null : tierRangeLabel(tiers, quote.tier),
      nextTierRange: nextTier === null ? null : tierRangeLabel(tiers, nextTier),
      inTrial: quote.inTrial,
      trialEndsAt: m.trialEndsAt ?? null,
      yearlyPriceCzk: quote.priceCzk,
      listPriceCzk: quote.listPriceCzk,
      floorCzk: quote.floorCzk,
      belowFloor: quote.belowFloor,
      customPrice: quote.customPrice,
      implementationFeeCzk: quote.implementationFeeCzk,
      contractYear: quote.contractYear,
      missing: quote.missing,
    },
    sms: {
      enabled: smsEnabled,
      package: smsPackage,
      quota: smsQuotaOf(m, catalog),
      hardLimit: smsHardLimitOf(smsQuotaOf(m, catalog), catalog),
      usedParts: smsUsed.parts,
      overageParts: smsUsed.overageParts,
      yearlyPriceCzk: smsPrice,
      overagePriceCzk: catalog.smsOveragePriceCzk,
    },
    scraping: {
      enabled: scraping.enabled,
      package: scraping.package,
      maxSources: scraping.maxSources,
      enabledSources,
      totalSources: sources.docs.length,
      slotDay: m.scrapingSlotDay ?? 1,
      slotHour: m.scrapingSlotHour ?? 2,
      frequency,
      maxInputTokensPerRun: scraping.maxInputTokensPerRun,
      packageMaxSources: catalog.scrapingPackages[scraping.package].maxSources,
      yearlyPriceCzk: scrapingPrice,
      freeThisYear: scrapingFree,
      setupFeeCzk: catalog.sourceSetupFeeCzk,
      cheaperPackage: cheaperScrapingPackage(catalog, scraping.package, enabledSources),
    },
    yearlyTotalCzk:
      quote.priceCzk === null
        ? null
        : quote.priceCzk + (smsEnabled ? smsPrice : 0) + (scraping.enabled ? scrapingPrice : 0),
  }
}

/** The obec's own view — its packages and use, no prices nor the contract's terms (internal). */
export const withoutPrices = (s: MunicipalityServices): MunicipalityServices => ({
  ...s,
  licence: {
    ...s.licence,
    yearlyPriceCzk: null,
    listPriceCzk: null,
    floorCzk: null,
    belowFloor: false,
    customPrice: false,
    implementationFeeCzk: null,
    contractYear: null,
    missing: [],
  },
  sms: { ...s.sms, yearlyPriceCzk: null, overagePriceCzk: null },
  scraping: { ...s.scraping, yearlyPriceCzk: null, setupFeeCzk: null, cheaperPackage: null },
  yearlyTotalCzk: null,
})
