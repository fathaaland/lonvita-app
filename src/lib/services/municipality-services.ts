import type { Payload } from 'payload'

import type { Municipality } from '@/payload-types'
import { computedTierOf, countActiveUsers, listActiveUserSnapshots } from '@/lib/billing/active-users'
import {
  cheaperScrapingPackage,
  getBillingCatalog,
  isPackageKey,
  scrapingYearlyPriceOf,
  tierRangeLabel,
  type PackageKey,
} from '@/lib/billing/catalog'
import { licencePeriodOf } from '@/lib/billing/period'
import { scrapingLimitsOf } from '@/lib/billing/scraping'
import { countSmsParts, smsQuotaOf } from '@/lib/billing/sms'

/**
 * What the obec has bought and how much of it it used (Balíčky služeb, lib/billing): the yearly
 * licence by the band of its users, the SMS package (a yearly quota of parts) and the scraping
 * package (a number of sources). E-mails come with the licence. The platform sees the prices too;
 * the obec only its packages and use (withoutPrices) — the prices are internal for now.
 */
export type MunicipalityServices = {
  billingStatus: 'active' | 'suspended'
  licence: {
    periodStart: string
    periodEnd: string
    /** Set by the platform rather than the calendar year. */
    periodCustom: boolean
    /** Its users right now (lib/billing/active-users). */
    activeUsers: number
    /** The average of the last three monthly snapshots — what the band is computed from. */
    averageUsers: number
    snapshotsUsed: number
    computedTier: number
    /** The band it's billed by — set by hand (tierManual), else the computed one. */
    tier: number
    tierManual: boolean
    tierRange: string
    yearlyPriceCzk: number | null
    customPrice: boolean
    implementationFeeCzk: number | null
  }
  sms: {
    enabled: boolean
    package: PackageKey
    quota: number
    usedParts: number
    overageParts: number
    overageAllowed: boolean
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
    /** What the package itself allows — `maxSources` past it are extra sources, billed each. */
    packageMaxSources: number
    extraSources: number
    /** The whole scraping a year: the package, the extra sources and twice-weekly reading. */
    yearlyPriceCzk: number | null
    packagePriceCzk: number | null
    extraSourcesPriceCzk: number | null
    frequencyPriceCzk: number | null
    setupFeeCzk: number | null
    /** A package that would give the same for less — a hint for the platform, never for the obec. */
    cheaperPackage: PackageKey | null
  }
  /** Licence + the add-ons it has on, a year — none for the obec's own view. */
  yearlyTotalCzk: number | null
}

type BillingDoc = Pick<
  Municipality,
  | 'billingStatus'
  | 'licencePeriodStart'
  | 'licencePeriodEnd'
  | 'licenceTier'
  | 'licenceCustomYearlyCzk'
  | 'implementationFeeCzk'
  | 'smsEnabled'
  | 'smsPackage'
  | 'smsQuotaOverride'
  | 'smsOverageAllowed'
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
  const [activeUsers, snapshots, smsUsed, scraping, sources] = await Promise.all([
    countActiveUsers(payload, municipalityId),
    listActiveUserSnapshots(payload, municipalityId, 3),
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
  const computed = computedTierOf(tiers, snapshots, activeUsers)
  const tierManual = m.licenceTier != null
  const tier = Math.min(tiers.length - 1, Math.max(0, m.licenceTier ?? computed.tier))
  const licencePrice = m.licenceCustomYearlyCzk ?? tiers[tier]?.yearlyPriceCzk ?? 0
  const smsPackage = isPackageKey(m.smsPackage) ? m.smsPackage : 's'
  const smsEnabled = m.smsEnabled === true
  const smsPrice = catalog.smsPackages[smsPackage].yearlyPriceCzk
  const frequency = m.scrapingFrequency === 'twice_weekly' ? 'twice_weekly' : 'weekly'
  const scrapingPrice = scrapingYearlyPriceOf(catalog, scraping.package, scraping.maxSources, frequency)

  return {
    billingStatus: m.billingStatus === 'suspended' ? 'suspended' : 'active',
    licence: {
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      periodCustom: period.custom,
      activeUsers,
      averageUsers: computed.averageUsers,
      snapshotsUsed: computed.fromSnapshots,
      computedTier: computed.tier,
      tier,
      tierManual,
      tierRange: tierRangeLabel(tiers, tier),
      yearlyPriceCzk: licencePrice,
      customPrice: m.licenceCustomYearlyCzk != null,
      implementationFeeCzk: m.implementationFeeCzk ?? catalog.implementationFeeCzk,
    },
    sms: {
      enabled: smsEnabled,
      package: smsPackage,
      quota: smsQuotaOf(m, catalog),
      usedParts: smsUsed.parts,
      overageParts: smsUsed.overageParts,
      overageAllowed: m.smsOverageAllowed === true,
      yearlyPriceCzk: smsPrice,
      overagePriceCzk: catalog.smsOveragePriceCzk,
    },
    scraping: {
      enabled: scraping.enabled,
      package: scraping.package,
      maxSources: scraping.maxSources,
      enabledSources: sources.docs.filter((s) => s.enabled).length,
      totalSources: sources.docs.length,
      slotDay: m.scrapingSlotDay ?? 1,
      slotHour: m.scrapingSlotHour ?? 2,
      frequency,
      maxInputTokensPerRun: scraping.maxInputTokensPerRun,
      packageMaxSources: catalog.scrapingPackages[scraping.package].maxSources,
      extraSources: scrapingPrice.extraSources,
      yearlyPriceCzk: scrapingPrice.totalCzk,
      packagePriceCzk: scrapingPrice.packageCzk,
      extraSourcesPriceCzk: scrapingPrice.extraSourcesCzk,
      frequencyPriceCzk: scrapingPrice.frequencyCzk,
      setupFeeCzk: catalog.sourceSetupFeeCzk,
      cheaperPackage: cheaperScrapingPackage(catalog, scraping.package, scraping.maxSources, frequency),
    },
    yearlyTotalCzk:
      licencePrice + (smsEnabled ? smsPrice : 0) + (scraping.enabled ? scrapingPrice.totalCzk : 0),
  }
}

/** The obec's own view — its packages and use, no prices (internal for now). */
export const withoutPrices = (s: MunicipalityServices): MunicipalityServices => ({
  ...s,
  licence: { ...s.licence, yearlyPriceCzk: null, implementationFeeCzk: null },
  sms: { ...s.sms, yearlyPriceCzk: null, overagePriceCzk: null },
  scraping: {
    ...s.scraping,
    yearlyPriceCzk: null,
    packagePriceCzk: null,
    extraSourcesPriceCzk: null,
    frequencyPriceCzk: null,
    setupFeeCzk: null,
    cheaperPackage: null,
  },
  yearlyTotalCzk: null,
})
