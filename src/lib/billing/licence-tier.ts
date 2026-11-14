import type { Payload } from 'payload'

import { recordAuditLog } from '@/collections/shared/auditLog'
import { escapeHtml, getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { logger, serializeError } from '@/lib/logger'

import { autumnAverageUsers, listActiveUserSnapshots } from './active-users'
import { getBillingCatalog, tierForPopulation, tierRangeLabel, type BillingCatalog } from './catalog'
import { licencePeriodOf, pragueMonthKey } from './period'

/**
 * Licenční pásmo (Ceník 2027, interní podklad 13. 11. 2026):
 *
 * - The band is by the obec's INHABITANTS, fixed for each licence year at its start — a number of
 *   inhabitants entered mid-year counts from the next year.
 * - Growth band: active users (lib/billing/active-users) up to activeUsersIncludedPercent of the
 *   inhabitants are in the price. Evaluated each autumn from the end-of-September and end-of-October
 *   snapshots: over it, the next licence year is one band higher than this one (never more than one a
 *   year; its price capped at growthCapCzk); not over it, back to the band by size. Never below the band
 *   by size, never during the year, never back. Announced to the obec right away (the price list
 *   promises by 15. 11.); users are never blocked.
 * - A band set by hand (Municipalities.licenceTier) or the contract's own price (licenceCustomYearlyCzk)
 *   are the contract's — the job leaves them alone. A lapsed licence isn't renewed, so nothing is fixed.
 */

export type TierReviewResult = { fixed: number; evaluated: number; raised: number; failed: number }

/** The month (1–12, Prague) the autumn evaluation starts — once both snapshots (1. 10., 1. 11.) are in. */
export const GROWTH_EVALUATION_MONTH = 11

type TierDoc = {
  id: number
  name: string
  population?: number | null
  licencePeriodStart?: string | null
  licencePeriodEnd?: string | null
  licencePaidUntil?: string | null
  licenceTier?: number | null
  licenceCustomYearlyCzk?: number | null
  licenceBilledTier?: number | null
  licenceBilledTierPeriod?: string | null
  licenceNextTier?: number | null
  licenceNextTierPeriod?: string | null
}

/** Daily (worker billing-status): every obec's band against its licence year — fixed at its start, and
 * the next year's decided in the autumn. */
export async function reviewLicenceTiers(payload: Payload, now: Date = new Date()): Promise<TierReviewResult> {
  const result: TierReviewResult = { fixed: 0, evaluated: 0, raised: 0, failed: 0 }
  const catalog = await getBillingCatalog(payload)
  const obce = await payload.find({
    collection: 'municipalities',
    where: { billingStatus: { not_equals: 'terminated' } },
    select: {
      name: true,
      population: true,
      licencePeriodStart: true,
      licencePeriodEnd: true,
      licencePaidUntil: true,
      licenceTier: true,
      licenceCustomYearlyCzk: true,
      licenceBilledTier: true,
      licenceBilledTierPeriod: true,
      licenceNextTier: true,
      licenceNextTierPeriod: true,
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const m of obce.docs as TierDoc[]) {
    try {
      await reviewOne(payload, catalog, m, now, result)
    } catch (error) {
      result.failed++
      logger.error('Licence tier review failed', { event: 'billing.tier_review_failed', municipalityId: m.id, ...serializeError(error) })
    }
  }
  if (result.fixed || result.evaluated || result.failed) logger.info('Licence tiers reviewed', { event: 'billing.tiers_reviewed', ...result })
  return result
}

async function reviewOne(payload: Payload, catalog: BillingCatalog, m: TierDoc, now: Date, result: TierReviewResult): Promise<void> {
  // The contract's own terms, or a licence nobody renewed — nothing for the job to decide.
  if (m.licenceTier != null || m.licenceCustomYearlyCzk != null) return
  if (typeof m.population !== 'number') return
  const period = licencePeriodOf(m, now)
  if (period.lapsed) return

  const tiers = catalog.licenceTiers
  const top = tiers.length - 1
  const base = tierForPopulation(tiers, m.population)

  // A new licence year: its band — by size, plus the growth band decided for it in the autumn.
  let current = m.licenceBilledTier
  if (m.licenceBilledTierPeriod !== period.key || current == null) {
    const decided = m.licenceNextTierPeriod === period.key && m.licenceNextTier != null ? m.licenceNextTier : base
    current = Math.min(top, Math.max(base, decided))
    await payload.update({
      collection: 'municipalities',
      id: m.id,
      data: { licenceBilledTier: current, licenceBilledTierPeriod: period.key },
      overrideAccess: true,
    })
    await recordAuditLog(payload, {
      action: 'municipalities.licence-tier-fixed',
      actor: null,
      targetCollection: 'municipalities',
      targetId: m.id,
      municipality: m.id,
      metadata: { periodKey: period.key, tier: current, baseTier: base, population: m.population },
    })
    result.fixed++
  }

  // The autumn: the next licence year's band, once.
  const [year, month] = pragueMonthKey(now).split('-').map(Number)
  if (month < GROWTH_EVALUATION_MONTH) return
  const next = licencePeriodOf({ ...m, licencePaidUntil: null }, period.paidEnd)
  if (m.licenceNextTierPeriod === next.key) return
  const average = autumnAverageUsers(await listActiveUserSnapshots(payload, m.id, 6), year)
  if (average === null) return

  const included = Math.floor((m.population * catalog.activeUsersIncludedPercent) / 100)
  const over = average > included
  const nextTier = over ? Math.min(top, current + 1) : base
  await payload.update({
    collection: 'municipalities',
    id: m.id,
    data: { licenceNextTier: nextTier, licenceNextTierPeriod: next.key, licenceNextTierUsers: average },
    overrideAccess: true,
  })
  await recordAuditLog(payload, {
    action: 'municipalities.licence-tier-evaluated',
    actor: null,
    targetCollection: 'municipalities',
    targetId: m.id,
    municipality: m.id,
    metadata: { nextPeriodKey: next.key, currentTier: current, nextTier, baseTier: base, activeUsers: average, included },
  })
  result.evaluated++
  if (nextTier === current) return

  const raised = nextTier > current
  if (raised) {
    result.raised++
    logger.warn(`Growth band: licence band ${current} → ${nextTier} from the next licence year (${average} active users, ${included} included)`, {
      event: 'billing.licence_tier_raised',
      municipalityId: m.id,
    })
  }
  // The obec sees no prices — only what changes and why.
  const from = next.start.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })
  const title = raised ? 'Od dalšího období vyšší licenční pásmo' : 'Od dalšího období zpět pásmo podle velikosti obce'
  const message = raised
    ? `Průměrný počet aktivních uživatelů obce na konci září a října (${average}) přesáhl ${catalog.activeUsersIncludedPercent} % ` +
      `obyvatel, které jsou v ceně licence (${included}). Od ${from} bude obec v pásmu pro ${tierRangeLabel(tiers, nextTier)} obyvatel, ` +
      'o jedno výš než teď. Uživatelé se nijak neomezují. Novou cenu vám pošle provozovatel Lonvity.'
    : `Počet aktivních uživatelů obce (${average}) je opět v ceně licence (${included}). ` +
      `Od ${from} bude obec v pásmu podle své velikosti (${tierRangeLabel(tiers, nextTier)} obyvatel).`
  await sendNotificationToMany(payload, await getMunicipalityAdminUserIds(payload, m.id), {
    title,
    message,
    link: '/admin-obce?tab=settings',
    email: { subject: `Lonvita: ${title}`, body: `<p>${escapeHtml(message)}</p>` },
  })
}
