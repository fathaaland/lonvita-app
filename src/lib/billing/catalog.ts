import type { Payload, PayloadRequest } from 'payload'

/**
 * What the platform sells an obec (Balíčky služeb, 27. 10. 2026): a yearly licence priced by the band
 * of its active users, plus two add-ons — SMS (a yearly quota of SMS parts) and scraping (a number of
 * event sources read weekly). All prices are Kč without VAT, yearly. The numbers are a working
 * hypothesis, so they live in the BillingSettings global and the superadmin changes them without a
 * deploy; these are its defaults (and the fallback while the global hasn't been saved yet).
 *
 * Everything an obec can be given is priced: a source switched on over its package (the superadmin
 * raised its limit) costs `scrapingExtraSourcePriceCzk` a year, reading twice a week `scrapingTwiceWeeklyPriceCzk`.
 * The AI's tokens never are — they are a fraction of the price; `scrapingCostAlertUsdPerSource` only
 * tells the platform when an obec's runs cost far more than they should.
 */

export const PACKAGE_KEYS = ['s', 'm', 'l'] as const
export type PackageKey = (typeof PACKAGE_KEYS)[number]
export const PACKAGE_LABELS: Record<PackageKey, string> = { s: 'S', m: 'M', l: 'L' }

export type LicenceTier = {
  /** Up to this many active users (inclusive); null for the last, open-ended band. */
  maxUsers: number | null
  yearlyPriceCzk: number
}

export type SmsPackage = { quota: number; yearlyPriceCzk: number }
export type ScrapingPackage = { maxSources: number; yearlyPriceCzk: number }

export type BillingCatalog = {
  licenceTiers: LicenceTier[]
  implementationFeeCzk: number
  smsPackages: Record<PackageKey, SmsPackage>
  smsOveragePriceCzk: number
  /** How far past its yearly quota an obec's SMS may go, in % of the quota — the hard cap on overage
   * (lib/billing/sms smsHardLimitOf). Past it nobody is texted, whatever one cancellation would need. */
  smsOverageCapPercent: number
  scrapingPackages: Record<PackageKey, ScrapingPackage>
  sourceSetupFeeCzk: number
  /** A source past the package's — Kč a year each (the superadmin raised the obec's limit). */
  scrapingExtraSourcePriceCzk: number
  /** Reading the sources twice a week instead of once — Kč a year on top of the package. */
  scrapingTwiceWeeklyPriceCzk: number
  /** The technical safety net on one scraping run — never billed (§ Doplněk scraping). */
  maxInputTokensPerRun: number
  /** What the AI may cost an obec a month per source it may have, in USD, before the platform is
   * told — never billed, never blocks anything (lib/billing/scraping-cost). */
  scrapingCostAlertUsdPerSource: number
}

export const DEFAULT_CATALOG: BillingCatalog = {
  licenceTiers: [
    { maxUsers: 100, yearlyPriceCzk: 36_000 },
    { maxUsers: 300, yearlyPriceCzk: 70_000 },
    { maxUsers: 500, yearlyPriceCzk: 100_000 },
    { maxUsers: 700, yearlyPriceCzk: 126_000 },
    { maxUsers: 900, yearlyPriceCzk: 148_000 },
    { maxUsers: 1100, yearlyPriceCzk: 166_000 },
    { maxUsers: 1300, yearlyPriceCzk: 180_000 },
    { maxUsers: 1500, yearlyPriceCzk: 190_000 },
    { maxUsers: null, yearlyPriceCzk: 200_000 },
  ],
  implementationFeeCzk: 5_000,
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
  // Above the per-source price of every package (M: 1 200, L: 1 056), so the next package is the
  // better deal once the obec needs several more.
  scrapingExtraSourcePriceCzk: 1_500,
  scrapingTwiceWeeklyPriceCzk: 2_400,
  maxInputTokensPerRun: 60_000,
  // A source read weekly costs about $0.01 a run; ten times what's expected before anyone looks.
  scrapingCostAlertUsdPerSource: 0.5,
}

type StoredPackage = Record<string, number | null | undefined> | null | undefined

type StoredCatalog = {
  licenceTiers?: { maxUsers?: number | null; yearlyPriceCzk?: number | null }[] | null
  implementationFeeCzk?: number | null
  smsOveragePriceCzk?: number | null
  smsOverageCapPercent?: number | null
  sourceSetupFeeCzk?: number | null
  scrapingExtraSourcePriceCzk?: number | null
  scrapingTwiceWeeklyPriceCzk?: number | null
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

/** The stored global over the defaults — any field left empty keeps its default. */
export function catalogFrom(stored: StoredCatalog | null | undefined): BillingCatalog {
  const d = DEFAULT_CATALOG
  if (!stored) return d
  const tiers = (stored.licenceTiers ?? [])
    .filter((t) => typeof t.yearlyPriceCzk === 'number')
    .map((t) => ({ maxUsers: t.maxUsers ?? null, yearlyPriceCzk: t.yearlyPriceCzk as number }))
    // Bands in order, the open-ended one last.
    .sort((a, b) => (a.maxUsers ?? Infinity) - (b.maxUsers ?? Infinity))
  const packages = <T extends Record<string, number>>(
    storedPackages: StoredCatalog['smsPackages'],
    fallback: Record<PackageKey, T>,
  ) =>
    Object.fromEntries(
      PACKAGE_KEYS.map((k) => [k, pick(storedPackages?.[k], fallback[k])]),
    ) as Record<PackageKey, T>
  return {
    licenceTiers: tiers.length > 0 ? tiers : d.licenceTiers,
    implementationFeeCzk: stored.implementationFeeCzk ?? d.implementationFeeCzk,
    smsPackages: packages(stored.smsPackages, d.smsPackages),
    smsOveragePriceCzk: stored.smsOveragePriceCzk ?? d.smsOveragePriceCzk,
    smsOverageCapPercent: stored.smsOverageCapPercent ?? d.smsOverageCapPercent,
    scrapingPackages: packages(stored.scrapingPackages, d.scrapingPackages),
    sourceSetupFeeCzk: stored.sourceSetupFeeCzk ?? d.sourceSetupFeeCzk,
    scrapingExtraSourcePriceCzk: stored.scrapingExtraSourcePriceCzk ?? d.scrapingExtraSourcePriceCzk,
    scrapingTwiceWeeklyPriceCzk: stored.scrapingTwiceWeeklyPriceCzk ?? d.scrapingTwiceWeeklyPriceCzk,
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

/** The band (0-based index) `activeUsers` falls in. */
export function tierForUsers(tiers: LicenceTier[], activeUsers: number): number {
  const index = tiers.findIndex((t) => t.maxUsers === null || activeUsers <= t.maxUsers)
  return index === -1 ? tiers.length - 1 : index
}

/** "0 až 100", "1 501 a víc" — how a band reads. */
export function tierRangeLabel(tiers: LicenceTier[], index: number): string {
  const from = index === 0 ? 0 : (tiers[index - 1]?.maxUsers ?? 0) + 1
  const to = tiers[index]?.maxUsers
  const n = (v: number) => v.toLocaleString('cs-CZ')
  return to == null ? `${n(from)} a víc` : `${n(from)} až ${n(to)}`
}

export const isPackageKey = (value: unknown): value is PackageKey =>
  typeof value === 'string' && (PACKAGE_KEYS as readonly string[]).includes(value)

export type ScrapingFrequency = 'weekly' | 'twice_weekly'

/** What the obec's scraping costs a year: its package, every source switched on past it, and reading
 * twice a week. `billedSources` are the ones switched on (and allowed); fewer than the package's is no
 * discount. */
export function scrapingYearlyPriceOf(
  catalog: BillingCatalog,
  pkg: PackageKey,
  billedSources: number,
  frequency: ScrapingFrequency,
): { packageCzk: number; extraSources: number; extraSourcesCzk: number; frequencyCzk: number; totalCzk: number } {
  const packageCzk = catalog.scrapingPackages[pkg].yearlyPriceCzk
  const extraSources = Math.max(0, billedSources - catalog.scrapingPackages[pkg].maxSources)
  const extraSourcesCzk = extraSources * catalog.scrapingExtraSourcePriceCzk
  const frequencyCzk = frequency === 'twice_weekly' ? catalog.scrapingTwiceWeeklyPriceCzk : 0
  return { packageCzk, extraSources, extraSourcesCzk, frequencyCzk, totalCzk: packageCzk + extraSourcesCzk + frequencyCzk }
}

/** A package that would give the obec its `billedSources` for less than it pays now — or null. */
export function cheaperScrapingPackage(
  catalog: BillingCatalog,
  current: PackageKey,
  billedSources: number,
  frequency: ScrapingFrequency,
): PackageKey | null {
  const now = scrapingYearlyPriceOf(catalog, current, billedSources, frequency).totalCzk
  let best: { key: PackageKey; czk: number } | null = null
  for (const key of PACKAGE_KEYS) {
    if (key === current) continue
    const czk = scrapingYearlyPriceOf(catalog, key, billedSources, frequency).totalCzk
    if (czk < now && (!best || czk < best.czk)) best = { key, czk }
  }
  return best?.key ?? null
}
