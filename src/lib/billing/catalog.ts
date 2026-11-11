import type { Payload, PayloadRequest } from 'payload'

/**
 * What the platform sells an obec (Balíčky služeb, 27. 10. 2026): a yearly licence priced by the band
 * of its active users, plus two add-ons — SMS (a yearly quota of SMS parts) and scraping (a number of
 * event sources read weekly). All prices are Kč without VAT, yearly. The numbers are a working
 * hypothesis, so they live in the BillingSettings global and the superadmin changes them without a
 * deploy; these are its defaults (and the fallback while the global hasn't been saved yet).
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
  scrapingPackages: Record<PackageKey, ScrapingPackage>
  sourceSetupFeeCzk: number
  /** The technical safety net on one scraping run — never billed (§ Doplněk scraping). */
  maxInputTokensPerRun: number
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
  scrapingPackages: {
    s: { maxSources: 3, yearlyPriceCzk: 5_400 },
    m: { maxSources: 10, yearlyPriceCzk: 12_000 },
    l: { maxSources: 25, yearlyPriceCzk: 26_400 },
  },
  sourceSetupFeeCzk: 500,
  maxInputTokensPerRun: 60_000,
}

type StoredPackage = Record<string, number | null | undefined> | null | undefined

type StoredCatalog = {
  licenceTiers?: { maxUsers?: number | null; yearlyPriceCzk?: number | null }[] | null
  implementationFeeCzk?: number | null
  smsOveragePriceCzk?: number | null
  sourceSetupFeeCzk?: number | null
  maxInputTokensPerRun?: number | null
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
    scrapingPackages: packages(stored.scrapingPackages, d.scrapingPackages),
    sourceSetupFeeCzk: stored.sourceSetupFeeCzk ?? d.sourceSetupFeeCzk,
    maxInputTokensPerRun: stored.maxInputTokensPerRun ?? d.maxInputTokensPerRun,
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
