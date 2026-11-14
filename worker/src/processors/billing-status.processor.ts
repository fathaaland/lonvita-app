import { reviewLicenceTiers } from '@/lib/billing/licence-tier'
import { advanceBillingStatuses } from '@/lib/billing/status-step'

import { getWorkerPayload } from '../runtime/payload'

import type { BillingStatusJobResult } from '@/lib/queue/contracts'

/** Daily: each obec's licence band against its licence year (lib/billing/licence-tier), then unpaid and
 * ended obce moved on (lib/billing/status-step). */
export const processBillingStatusJob = async (now: Date = new Date()): Promise<BillingStatusJobResult> => {
  const payload = await getWorkerPayload()
  const tiers = await reviewLicenceTiers(payload, now)
  const result = await advanceBillingStatuses(payload, now)
  return { ...result, tiersFixed: tiers.fixed, tierUpgrades: tiers.upgraded, failed: result.failed + tiers.failed }
}
