import { advanceBillingStatuses } from '@/lib/billing/status-step'

import { getWorkerPayload } from '../runtime/payload'

import type { BillingStatusJobResult } from '@/lib/queue/contracts'

/** Daily: unpaid obce warned a week ahead, then made read-only (lib/billing/status-step). */
export const processBillingStatusJob = async (now: Date = new Date()): Promise<BillingStatusJobResult> =>
  advanceBillingStatuses(await getWorkerPayload(), now)
