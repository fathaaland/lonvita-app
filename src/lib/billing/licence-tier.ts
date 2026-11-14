import type { Payload } from 'payload'

import { recordAuditLog } from '@/collections/shared/auditLog'
import { escapeHtml, getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { logger, serializeError } from '@/lib/logger'

import { computedTierOf, countActiveUsers, listActiveUserSnapshots } from './active-users'
import { getBillingCatalog, tierRangeLabel, type BillingCatalog } from './catalog'
import { licencePeriodOf, monthRange, pragueMonthKey } from './period'

/**
 * Přechod licenčního pásma (decided 14. 11. 2026):
 *
 * - The band is fixed for the licence year: set when the year begins (the renewal) from the average of
 *   the last three monthly snapshots — a smaller obec gets the lower band then, never mid-year.
 * - An obec that outgrows its band mid-year (the average passes the band's top) moves up from the next
 *   month and owes the price difference for the months of the year still to come — never back
 *   (LicenceUpgrades, what the platform invoices from). Its admins and the platform are told.
 * - A band set by hand (Municipalities.licenceTier) and an individual price (licenceCustomYearlyCzk)
 *   are the contract's — the job leaves them alone. A lapsed licence isn't renewed, so nothing is fixed.
 *
 * "Users" are every registered account of the obec (lib/billing/active-users) — decided 2. 11. 2026,
 * not the PDF's "logged in within 90 days".
 */

const nextMonthKey = (key: string): string => pragueMonthKey(monthRange(key).to)

/** Month starts (Prague) at or after `from` and before `to` — how many whole billing months lie between. */
export function monthStartsBetween(from: Date, to: Date): number {
  let key = pragueMonthKey(from)
  if (monthRange(key).from.getTime() < from.getTime()) key = nextMonthKey(key)
  let n = 0
  while (monthRange(key).from.getTime() < to.getTime()) {
    n++
    key = nextMonthKey(key)
    if (n > 1200) break
  }
  return n
}

/** What moving from one band's yearly price to another's costs for `monthsCharged` of `periodMonths`. */
export const proratedSurcharge = (fromYearly: number, toYearly: number, monthsCharged: number, periodMonths: number): number =>
  periodMonths > 0 ? Math.max(0, Math.round(((toYearly - fromYearly) * monthsCharged) / periodMonths)) : 0

/** The band the obec is billed in for `periodKey`: the one fixed for that year, else what it would be fixed at. */
export function billedTierOf(
  m: { licenceTier?: number | null; licenceBilledTier?: number | null; licenceBilledTierPeriod?: string | null },
  periodKey: string,
  computedTier: number,
): { tier: number; fixed: boolean } {
  if (m.licenceTier != null) return { tier: m.licenceTier, fixed: true }
  if (m.licenceBilledTierPeriod === periodKey && m.licenceBilledTier != null) return { tier: m.licenceBilledTier, fixed: true }
  return { tier: computedTier, fixed: false }
}

export type TierReviewResult = { fixed: number; upgraded: number; failed: number }

/** Daily (worker billing-status): every obec's band against its licence year — fixed at its start, raised on growth. */
export async function reviewLicenceTiers(payload: Payload, now: Date = new Date()): Promise<TierReviewResult> {
  const result: TierReviewResult = { fixed: 0, upgraded: 0, failed: 0 }
  const catalog = await getBillingCatalog(payload)
  const obce = await payload.find({
    collection: 'municipalities',
    where: { billingStatus: { not_equals: 'terminated' } },
    select: {
      name: true,
      licencePeriodStart: true,
      licencePeriodEnd: true,
      licencePaidUntil: true,
      licenceTier: true,
      licenceCustomYearlyCzk: true,
      licenceBilledTier: true,
      licenceBilledTierPeriod: true,
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const m of obce.docs) {
    try {
      const outcome = await reviewOne(payload, catalog, m, now)
      if (outcome === 'fixed') result.fixed++
      if (outcome === 'upgraded') result.upgraded++
    } catch (error) {
      result.failed++
      logger.error('Licence tier review failed', { event: 'billing.tier_review_failed', municipalityId: m.id, ...serializeError(error) })
    }
  }
  if (result.fixed || result.upgraded || result.failed) logger.info('Licence tiers reviewed', { event: 'billing.tiers_reviewed', ...result })
  return result
}

type TierDoc = {
  id: number
  name: string
  licencePeriodStart?: string | null
  licencePeriodEnd?: string | null
  licencePaidUntil?: string | null
  licenceTier?: number | null
  licenceCustomYearlyCzk?: number | null
  licenceBilledTier?: number | null
  licenceBilledTierPeriod?: string | null
}

async function reviewOne(payload: Payload, catalog: BillingCatalog, m: TierDoc, now: Date): Promise<'fixed' | 'upgraded' | null> {
  // The contract's own terms, or a licence nobody renewed — nothing for the job to decide.
  if (m.licenceTier != null || m.licenceCustomYearlyCzk != null) return null
  const period = licencePeriodOf(m, now)
  if (period.lapsed) return null

  const tiers = catalog.licenceTiers
  const snapshots = await listActiveUserSnapshots(payload, m.id, 3)
  const computed = computedTierOf(tiers, snapshots, snapshots.length > 0 ? 0 : await countActiveUsers(payload, m.id))
  const top = tiers.length - 1
  const target = Math.min(top, Math.max(0, computed.tier))

  // A new licence year: its band, from the users as they are — down as well as up.
  if (m.licenceBilledTierPeriod !== period.key || m.licenceBilledTier == null) {
    await payload.update({
      collection: 'municipalities',
      id: m.id,
      data: { licenceBilledTier: target, licenceBilledTierPeriod: period.key },
      overrideAccess: true,
    })
    await recordAuditLog(payload, {
      action: 'municipalities.licence-tier-fixed',
      actor: null,
      targetCollection: 'municipalities',
      targetId: m.id,
      municipality: m.id,
      metadata: { periodKey: period.key, tier: target, averageUsers: computed.averageUsers },
    })
    return 'fixed'
  }

  const current = Math.min(top, Math.max(0, m.licenceBilledTier))
  // Smaller mid-year: the price stays until the next year.
  if (target <= current) return null

  const effectiveFrom = monthRange(nextMonthKey(pragueMonthKey(now))).from
  const monthsCharged = monthStartsBetween(effectiveFrom, period.paidEnd)
  // The year ends before the next month — the renewal fixes the right band.
  if (monthsCharged <= 0) return null
  const periodMonths = Math.max(1, monthStartsBetween(period.start, period.paidEnd))
  const fromYearlyCzk = tiers[current]?.yearlyPriceCzk ?? 0
  const toYearlyCzk = tiers[target]?.yearlyPriceCzk ?? 0
  const surchargeCzk = proratedSurcharge(fromYearlyCzk, toYearlyCzk, monthsCharged, periodMonths)

  await payload.create({
    collection: 'licence-upgrades',
    data: {
      municipality: m.id,
      periodKey: period.key,
      fromTier: current,
      toTier: target,
      averageUsers: computed.averageUsers,
      effectiveFrom: effectiveFrom.toISOString(),
      monthsCharged,
      periodMonths,
      fromYearlyCzk,
      toYearlyCzk,
      surchargeCzk,
    },
    overrideAccess: true,
  })
  await payload.update({ collection: 'municipalities', id: m.id, data: { licenceBilledTier: target }, overrideAccess: true })
  await recordAuditLog(payload, {
    action: 'municipalities.licence-tier-upgraded',
    actor: null,
    targetCollection: 'municipalities',
    targetId: m.id,
    municipality: m.id,
    metadata: { periodKey: period.key, fromTier: current, toTier: target, monthsCharged, periodMonths, surchargeCzk },
  })
  logger.warn(`Licence band raised ${current} → ${target}, surcharge ${surchargeCzk} Kč for ${monthsCharged} months — invoice it`, {
    event: 'billing.licence_tier_upgraded',
    municipalityId: m.id,
  })

  // The obec sees no prices (internal for now) — only what changed and why.
  const month = effectiveFrom.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', month: 'long', year: 'numeric' })
  const title = 'Licence obce přechází do vyššího pásma'
  const message =
    `Průměrný počet uživatelů obce za poslední 3 měsíce (${computed.averageUsers}) přerostl licenční pásmo ` +
    `pro ${tierRangeLabel(tiers, current)} uživatelů. Od ${month} je obec v pásmu pro ${tierRangeLabel(tiers, target)} uživatelů. ` +
    'Rozdíl ceny za zbývající měsíce licenčního roku vám vyúčtuje provozovatel Lonvity, zpětně se nic nedoplácí. ' +
    'Do nižšího pásma se obec může vrátit až při obnově licence.'
  await sendNotificationToMany(payload, await getMunicipalityAdminUserIds(payload, m.id), {
    title,
    message,
    link: '/admin-obce?tab=settings',
    email: { subject: `Lonvita: ${title}`, body: `<p>${escapeHtml(message)}</p>` },
  })
  return 'upgraded'
}
