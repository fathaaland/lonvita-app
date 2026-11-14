import { tierForPopulation, type BillingCatalog } from './catalog'
import { pragueMonthKey } from './period'

/**
 * The obec's licence price for one licence year, by the price list (Ceník 2027) and its contract:
 *
 * 1. The band — by hand (Municipalities.licenceTier, the contract's), else the one fixed for the year by
 *    the billing job (its size, plus the growth band — lib/billing/licence-tier), else by its size now.
 * 2. The band's price — or the contract's own (licenceCustomYearlyCzk), which then stands as it is.
 *    The last band is individual: without the contract's price there is no price.
 * 3. Above its size (the growth band) the price never goes over growthCapCzk.
 * 4. The first wave pays the band's floor its first year.
 * 5. From the contract's second year the price moves by the inflation the platform entered (ČSÚ).
 * 6. A 3-year contract: threeYearDiscountPercent off for its whole length (the first wave from year 2).
 *
 * The implementation: the band by size's fee (or the contract's own), half for a reference.
 * Floors are internal — a price under the band's floor needs an agreed exception (floorExceptionNote).
 */

export type LicenceContractFields = {
  population?: number | null
  licenceTier?: number | null
  licenceBilledTier?: number | null
  licenceBilledTierPeriod?: string | null
  licenceCustomYearlyCzk?: number | null
  implementationFeeCzk?: number | null
  contractStart?: string | null
  contractYears?: number | null
  firstWave?: boolean | null
  referenceDiscount?: boolean | null
  priceIndexPercent?: number | null
  floorExceptionNote?: string | null
  trialEndsAt?: string | null
}

export type LicenceQuote = {
  /** The band by the obec's size; null without a number of inhabitants. */
  baseTier: number | null
  /** The band it's billed by this year (see above); null without inhabitants nor a band by hand. */
  tier: number | null
  tierManual: boolean
  /** Fixed for this licence year (by hand or by the billing job). */
  tierFixedForYear: boolean
  /** Bands over its size — the growth band. */
  growthSteps: number
  /** The year of the contract this licence year falls in (1 = the first). */
  contractYear: number
  /** The band's price-list price; null when individual or unknown. */
  listPriceCzk: number | null
  /** What it pays this licence year; null when nobody set a price for an individual band. */
  priceCzk: number | null
  customPrice: boolean
  floorCzk: number | null
  /** Below the floor — needs an agreed exception. */
  belowFloor: boolean
  implementationFeeCzk: number | null
  /** The first wave's first year: loading events (package S) is free. */
  scrapingSFree: boolean
  inTrial: boolean
  /** What's missing for a price — shown to the platform. */
  missing: string[]
}

/** Months (Prague) from `from`'s month to `to`'s. */
const monthsBetween = (from: Date, to: Date): number => {
  const [fy, fm] = pragueMonthKey(from).split('-').map(Number)
  const [ty, tm] = pragueMonthKey(to).split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

/** Which year of the contract a licence year starting at `periodStart` is: the first wave's licence
 * starts a month after the contract (that month is the implementation). */
export function contractYearOf(m: Pick<LicenceContractFields, 'contractStart' | 'firstWave'>, periodStart: Date): number {
  if (!m.contractStart) return 1
  const months = monthsBetween(new Date(m.contractStart), periodStart) - (m.firstWave ? 1 : 0)
  return Math.floor(Math.max(0, months) / 12) + 1
}

export function licenceQuote(
  catalog: BillingCatalog,
  m: LicenceContractFields,
  period: { key: string; start: Date },
  now: Date = new Date(),
): LicenceQuote {
  const tiers = catalog.licenceTiers
  const top = tiers.length - 1
  const clamp = (t: number) => Math.min(top, Math.max(0, t))
  const missing: string[] = []

  const baseTier = typeof m.population === 'number' && m.population >= 0 ? tierForPopulation(tiers, m.population) : null
  if (baseTier === null && m.licenceTier == null) missing.push('počet obyvatel')

  const tierManual = m.licenceTier != null
  const fixed = m.licenceBilledTierPeriod === period.key && m.licenceBilledTier != null
  const tier = tierManual ? clamp(m.licenceTier as number) : fixed ? clamp(m.licenceBilledTier as number) : baseTier
  const growthSteps = tier !== null && baseTier !== null ? Math.max(0, tier - baseTier) : 0
  const contractYear = contractYearOf(m, period.start)

  const band = tier !== null ? tiers[tier] : undefined
  const listPriceCzk = band?.yearlyPriceCzk ?? null
  const customPrice = m.licenceCustomYearlyCzk != null
  let priceCzk: number | null
  if (customPrice) {
    priceCzk = m.licenceCustomYearlyCzk as number
  } else if (listPriceCzk === null && growthSteps === 0) {
    priceCzk = null
    if (tier !== null) missing.push('individuální cena (poslední pásmo)')
  } else {
    // Grown into the individual band — the growth cap is its price.
    let price = listPriceCzk ?? catalog.growthCapCzk
    if (growthSteps > 0) price = Math.min(price, catalog.growthCapCzk)
    if (m.firstWave && contractYear === 1) price = band!.floorCzk
    if (contractYear >= 2 && m.priceIndexPercent) price *= 1 + m.priceIndexPercent / 100
    const threeYear = m.contractYears === 3 && (!m.firstWave || contractYear >= 2)
    if (threeYear) price *= 1 - catalog.threeYearDiscountPercent / 100
    priceCzk = Math.round(price)
  }

  const floorCzk = band?.floorCzk ?? null
  const baseBand = baseTier !== null ? tiers[baseTier] : band
  const fee = m.implementationFeeCzk ?? baseBand?.implementationFeeCzk ?? null
  const implementationFeeCzk =
    fee === null ? null : m.referenceDiscount ? Math.round(fee * (1 - catalog.referenceImplementationDiscountPercent / 100)) : fee

  return {
    baseTier,
    tier,
    tierManual,
    tierFixedForYear: tierManual || fixed,
    growthSteps,
    contractYear,
    listPriceCzk,
    priceCzk,
    customPrice,
    floorCzk,
    belowFloor: priceCzk !== null && floorCzk !== null && priceCzk < floorCzk,
    implementationFeeCzk,
    scrapingSFree: Boolean(m.firstWave) && contractYear === 1,
    inTrial: Boolean(m.trialEndsAt) && now.getTime() < new Date(m.trialEndsAt as string).getTime(),
    missing,
  }
}
