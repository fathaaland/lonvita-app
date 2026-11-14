import type { Payload, PayloadRequest } from 'payload'

/**
 * What the platform sells an obec (Ceník platformy Lonvita, platný od 1. 11. 2026; interní podklad
 * 13. 11. 2026): a yearly licence priced by the band of the obec's INHABITANTS (ČSÚ, 1. 1. of the year
 * the contract is signed), with a one-off implementation fee per band, plus two add-ons — SMS (a yearly
 * quota of SMS parts) and loading events from websites (a number of sources read weekly). All prices
 * are Kč without VAT, yearly. They live in the BillingSettings global — the superadmin changes them
 * without a deploy; these are its defaults (and the fallback while the global hasn't been saved).
 *
 * Internal, never shown to an obec: each band's floor (the lowest price we sell it for), the growth
 * band (active users over ACTIVE_USERS_INCLUDED_PERCENT of the inhabitants move the obec one band up
 * from the next period, lib/billing/licence-tier), and the standard discounts (lib/billing/licence-price).
 * The AI's tokens are never billed — `scrapingCostAlertUsdPerSource` only tells the platform when an
 * obec's runs cost far more than they should.
 */

export const PACKAGE_KEYS = ['s', 'm', 'l'] as const
export type PackageKey = (typeof PACKAGE_KEYS)[number]
export const PACKAGE_LABELS: Record<PackageKey, string> = { s: 'S', m: 'M', l: 'L' }

export type LicenceTier = {
  /** Up to this many inhabitants (inclusive); null for the last, open-ended band. */
  maxPopulation: number | null
  /** The price list's yearly price; null — individual (the contract's own price, licenceCustomYearlyCzk). */
  yearlyPriceCzk: number | null
  /** The lowest yearly price the band is sold for — internal; below it only an agreed exception. */
  floorCzk: number
  /** One-off, with the first payment. */
  implementationFeeCzk: number
}

export type SmsPackage = { quota: number; yearlyPriceCzk: number }
export type ScrapingPackage = { maxSources: number; yearlyPriceCzk: number }

export type BillingCatalog = {
  licenceTiers: LicenceTier[]
  /** Active users up to this share of the inhabitants are in the price; over it — the growth band. */
  activeUsersIncludedPercent: number
  /** What the growth band can take a licence up to, a year (the band by size may cost more). */
  growthCapCzk: number
  /** A 3-year contract instead of 2 — off the licence for its whole length (the first wave from year 2). */
  threeYearDiscountPercent: number
  /** Agreeing to be a reference — off the implementation fee. */
  referenceImplementationDiscountPercent: number
  smsPackages: Record<PackageKey, SmsPackage>
  smsOveragePriceCzk: number
  /** How far past its yearly quota an obec's SMS may go, in % of the quota — the hard cap on overage
   * (lib/billing/sms smsHardLimitOf). Past it nobody is texted, whatever one cancellation would need. */
  smsOverageCapPercent: number
  scrapingPackages: Record<PackageKey, ScrapingPackage>
  /** Each new web address, once. */
  sourceSetupFeeCzk: number
  /** The technical safety net on one scraping run — never billed. */
  maxInputTokensPerRun: number
  /** What the AI may cost an obec a month per source it may have, in USD, before the platform is
   * told — never billed, never blocks anything (lib/billing/scraping-cost). */
  scrapingCostAlertUsdPerSource: number
}

export const DEFAULT_CATALOG: BillingCatalog = {
  licenceTiers: [
    { maxPopulation: 999, yearlyPriceCzk: 13_200, floorCzk: 12_000, implementationFeeCzk: 5_000 },
    { maxPopulation: 1_999, yearlyPriceCzk: 19_800, floorCzk: 18_000, implementationFeeCzk: 5_000 },
    { maxPopulation: 4_999, yearlyPriceCzk: 33_000, floorCzk: 30_000, implementationFeeCzk: 5_000 },
    { maxPopulation: 9_999, yearlyPriceCzk: 59_400, floorCzk: 54_000, implementationFeeCzk: 10_000 },
    { maxPopulation: 19_999, yearlyPriceCzk: 85_800, floorCzk: 78_000, implementationFeeCzk: 10_000 },
    { maxPopulation: 49_999, yearlyPriceCzk: 118_800, floorCzk: 108_000, implementationFeeCzk: 15_000 },
    { maxPopulation: 99_999, yearlyPriceCzk: 165_000, floorCzk: 150_000, implementationFeeCzk: 15_000 },
    { maxPopulation: null, yearlyPriceCzk: null, floorCzk: 150_000, implementationFeeCzk: 15_000 },
  ],
  activeUsersIncludedPercent: 5,
  growthCapCzk: 200_000,
  threeYearDiscountPercent: 5,
  referenceImplementationDiscountPercent: 50,
  smsPackages: {
    s: { quota: 1_200, yearlyPriceCzk: 3_600 },
    m: { quota: 3_600, yearlyPriceCzk: 9_000 },
    l: { quota: 12_000, yearlyPriceCzk: 26_400 },
  },
  smsOveragePriceCzk: 2.5,
  smsOverageCapPercent: 50,
  scrapingPackages: {
    s: { maxSources: 3, yearlyPriceCzk: 5_400 },
    m: { maxSources: 10, yearlyPriceCzk: 12_000 },
    l: { maxSources: 25, yearlyPriceCzk: 26_400 },
  },
  sourceSetupFeeCzk: 500,
  maxInputTokensPerRun: 60_000,
  // A source read weekly costs about $0.01 a run; ten times what's expected before anyone looks.
  scrapingCostAlertUsdPerSource: 0.5,
}

type StoredPackage = Record<string, number | null | undefined> | null | undefined

type StoredTier = {
  maxPopulation?: number | null
  yearlyPriceCzk?: number | null
  floorCzk?: number | null
  implementationFeeCzk?: number | null
}

export type StoredCatalog = {
  licenceTiers?: StoredTier[] | null
  activeUsersIncludedPercent?: number | null
  growthCapCzk?: number | null
  threeYearDiscountPercent?: number | null
  referenceImplementationDiscountPercent?: number | null
  smsOveragePriceCzk?: number | null
  smsOverageCapPercent?: number | null
  sourceSetupFeeCzk?: number | null
  maxInputTokensPerRun?: number | null
  scrapingCostAlertUsdPerSource?: number | null
  smsPackages?: Partial<Record<PackageKey, StoredPackage>> | null
  scrapingPackages?: Partial<Record<PackageKey, StoredPackage>> | null
}

/** Each number of `fallback` — the stored one where it's set. */
const pick = <T extends Record<string, number>>(value: StoredPackage, fallback: T): T =>
  Object.fromEntries(
    Object.entries(fallback).map(([k, v]) => [k, typeof value?.[k] === 'number' ? value[k] : v]),
  ) as T

/** The stored global over the defaults — any field left empty keeps its default. Bands of the price
 * list before 1. 11. 2026 (by users, no floor) are ignored: the stored list counts only in the new form. */
export function catalogFrom(stored: StoredCatalog | null | undefined): BillingCatalog {
  const d = DEFAULT_CATALOG
  if (!stored) return d
  const tiers = (stored.licenceTiers ?? [])
    .filter((t) => typeof t.floorCzk === 'number' && typeof t.implementationFeeCzk === 'number')
    .map((t) => ({
      maxPopulation: t.maxPopulation ?? null,
      yearlyPriceCzk: typeof t.yearlyPriceCzk === 'number' ? t.yearlyPriceCzk : null,
      floorCzk: t.floorCzk as number,
      implementationFeeCzk: t.implementationFeeCzk as number,
    }))
    // Bands in order, the open-ended one last.
    .sort((a, b) => (a.maxPopulation ?? Infinity) - (b.maxPopulation ?? Infinity))
  const packages = <T extends Record<string, number>>(
    storedPackages: StoredCatalog['smsPackages'],
    fallback: Record<PackageKey, T>,
  ) =>
    Object.fromEntries(
      PACKAGE_KEYS.map((k) => [k, pick(storedPackages?.[k], fallback[k])]),
    ) as Record<PackageKey, T>
  return {
    licenceTiers: tiers.length > 0 ? tiers : d.licenceTiers,
    activeUsersIncludedPercent: stored.activeUsersIncludedPercent ?? d.activeUsersIncludedPercent,
    growthCapCzk: stored.growthCapCzk ?? d.growthCapCzk,
    threeYearDiscountPercent: stored.threeYearDiscountPercent ?? d.threeYearDiscountPercent,
    referenceImplementationDiscountPercent:
      stored.referenceImplementationDiscountPercent ?? d.referenceImplementationDiscountPercent,
    smsPackages: packages(stored.smsPackages, d.smsPackages),
    smsOveragePriceCzk: stored.smsOveragePriceCzk ?? d.smsOveragePriceCzk,
    smsOverageCapPercent: stored.smsOverageCapPercent ?? d.smsOverageCapPercent,
    scrapingPackages: packages(stored.scrapingPackages, d.scrapingPackages),
    sourceSetupFeeCzk: stored.sourceSetupFeeCzk ?? d.sourceSetupFeeCzk,
    maxInputTokensPerRun: stored.maxInputTokensPerRun ?? d.maxInputTokensPerRun,
    scrapingCostAlertUsdPerSource: stored.scrapingCostAlertUsdPerSource ?? d.scrapingCostAlertUsdPerSource,
  }
}

export async function getBillingCatalog(payload: Payload, req?: PayloadRequest): Promise<BillingCatalog> {
  const stored = await payload
    .findGlobal({ slug: 'billing-settings', depth: 0, overrideAccess: true, req })
    .catch(() => null)
  return catalogFrom(stored as StoredCatalog | null)
}

/** The band (0-based index) an obec of `population` inhabitants falls in. */
export function tierForPopulation(tiers: LicenceTier[], population: number): number {
  const index = tiers.findIndex((t) => t.maxPopulation === null || population <= t.maxPopulation)
  return index === -1 ? tiers.length - 1 : index
}

/** "1 000 až 1 999", "100 000 a víc" — how a band reads (in inhabitants). */
export function tierRangeLabel(tiers: LicenceTier[], index: number): string {
  const from = index === 0 ? 0 : (tiers[index - 1]?.maxPopulation ?? 0) + 1
  const to = tiers[index]?.maxPopulation
  const n = (v: number) => v.toLocaleString('cs-CZ')
  if (index === 0 && to != null) return `do ${n(to)}`
  return to == null ? `${n(from)} a víc` : `${n(from)} až ${n(to)}`
}

export const isPackageKey = (value: unknown): value is PackageKey =>
  typeof value === 'string' && (PACKAGE_KEYS as readonly string[]).includes(value)

/** What the obec's loading of events costs a year — its package; a limit the platform raised for it
 * or reading twice a week are no longer sold (Ceník 2027), so they cost nothing extra. */
export const scrapingYearlyPriceOf = (catalog: BillingCatalog, pkg: PackageKey): number =>
  catalog.scrapingPackages[pkg].yearlyPriceCzk

/** A smaller package that would still cover the obec's `enabledSources` — a hint for the platform. */
export function cheaperScrapingPackage(catalog: BillingCatalog, current: PackageKey, enabledSources: number): PackageKey | null {
  const now = scrapingYearlyPriceOf(catalog, current)
  let best: { key: PackageKey; czk: number } | null = null
  for (const key of PACKAGE_KEYS) {
    const czk = scrapingYearlyPriceOf(catalog, key)
    if (key === current || czk >= now || catalog.scrapingPackages[key].maxSources < enabledSources) continue
    if (!best || czk < best.czk) best = { key, czk }
  }
  return best?.key ?? null
}
