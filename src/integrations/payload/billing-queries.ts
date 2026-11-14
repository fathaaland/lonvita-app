import { del, get, patch, post } from './client'

import type { BillingCatalog, PackageKey } from '@/lib/billing/catalog'
import type { ActiveUserSnapshot } from '@/lib/billing/active-users'
import type { BillingDetail, BillingRow, BillingSettingsOfObec } from '@/lib/billing/report'

/**
 * The superadmin's billing (Balíčky služeb) — the price list, each obec's packages and use, the
 * monthly overview and its CSV. Platform admins only; every endpoint checks it again.
 */

export type { BillingDetail, BillingRow, BillingSettingsOfObec }

export type StoredCatalog = {
  licenceTiers?: { maxUsers?: number | null; yearlyPriceCzk?: number | null }[] | null
  implementationFeeCzk?: number | null
  smsPackages?: Partial<
    Record<PackageKey, { quota?: number | null; yearlyPriceCzk?: number | null }>
  > | null
  smsOveragePriceCzk?: number | null
  scrapingPackages?: Partial<
    Record<PackageKey, { maxSources?: number | null; yearlyPriceCzk?: number | null }>
  > | null
  sourceSetupFeeCzk?: number | null
  scrapingExtraSourcePriceCzk?: number | null
  scrapingTwiceWeeklyPriceCzk?: number | null
  maxInputTokensPerRun?: number | null
  scrapingCostAlertUsdPerSource?: number | null
}

/** The price list as stored — fields never saved come back empty and the defaults fill them. */
export async function getStoredBillingCatalog(): Promise<StoredCatalog> {
  return get<StoredCatalog>('/globals/billing-settings?depth=0')
}

export async function saveBillingCatalog(catalog: BillingCatalog): Promise<void> {
  await post('/globals/billing-settings', catalog)
}

export async function getBillingOverview(
  month?: string,
): Promise<{ month: string; rows: BillingRow[] }> {
  return get(`/superadmin/billing${month ? `?month=${encodeURIComponent(month)}` : ''}`)
}

/** Where the month's CSV downloads from (the browser sends the session cookie along). */
export const billingCsvUrl = (month: string) =>
  `/api/superadmin/billing?month=${encodeURIComponent(month)}&format=csv`

export async function getBillingDetail(municipalityId: string): Promise<BillingDetail> {
  return get(`/superadmin/billing/${municipalityId}`)
}

/** The obec's packages — Municipalities' platform-only fields; each change lands in the audit log. */
export async function saveMunicipalityBilling(
  municipalityId: string,
  settings: Omit<BillingSettingsOfObec, 'name'>,
): Promise<void> {
  await patch(`/municipalities/${municipalityId}`, settings)
}

/** The platform confirms (by typing the obec's name) that the terminated obec is to be erased for good. */
export async function confirmObecErasure(municipalityId: string, confirmName: string): Promise<{ confirmed: true }> {
  return post(`/superadmin/billing/${municipalityId}/erasure`, { confirmName })
}

export async function withdrawObecErasure(municipalityId: string): Promise<void> {
  await del(`/superadmin/billing/${municipalityId}/erasure`)
}

export async function takeActiveUserSnapshot(municipalityId: string): Promise<ActiveUserSnapshot> {
  return post(`/superadmin/billing/${municipalityId}/snapshot`)
}

export async function reviewImportRun(
  runId: number,
  reviewStatus: 'ok' | 'problem' | null,
  reviewNote?: string,
): Promise<void> {
  await patch(`/superadmin/import-runs/${runId}`, { reviewStatus, reviewNote })
}

export type { EventAreaMap, EventAreaPoint, EventArea } from '@/lib/events/area'

/** The obec's published, coming events against its contractual radius (superadmin map). */
export async function getEventAreaMap(municipalityId: string): Promise<import('@/lib/events/area').EventAreaMap> {
  return get(`/superadmin/municipalities/${municipalityId}/event-map`)
}

/** The same for all obce of a mikroregion. */
export async function getRegionEventAreaMap(microregionId: string): Promise<import('@/lib/events/area').EventAreaMap> {
  return get(`/superadmin/microregions/${microregionId}/event-map`)
}
