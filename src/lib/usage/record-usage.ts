import { logger, serializeError } from '@/lib/logger'
import { computeUsageCost, getUsagePricing } from '@/lib/providers/usage-pricing'

import type {
  UsageEventOperationType,
  UsageEventSource,
  UsageEventStatus,
} from '@/collections/UsageEvents'
import type { UsageAmount } from '@/lib/providers/usage-pricing'
import type { Payload } from 'payload'

export type RecordUsageEventParams = {
  municipalityId: number
  userId?: number | null
  organizationId?: number | null
  eventSourceId?: number | null
  importRunId?: number | null
  provider: string
  model: string
  operationType: UsageEventOperationType
  source: UsageEventSource
  usage: UsageAmount
  status?: UsageEventStatus
  requestId?: string
}

/**
 * Writes one row to the `usage-events` ledger — the source of truth for per-obec/per-user
 * token & cost accounting (ported from hbai-app). Failures are caught and logged, not rethrown: a
 * usage-tracking write must never fail the caller's primary operation (e.g. an import), so a
 * lost row shows up only in logs, not as a downstream error.
 */
export async function recordUsageEvent(
  payload: Payload,
  params: RecordUsageEventParams,
): Promise<void> {
  const pricing = getUsagePricing(params.provider, params.model)
  const cost = computeUsageCost(params.usage, pricing)

  try {
    await payload.create({
      collection: 'usage-events',
      data: {
        municipality: params.municipalityId,
        user: params.userId ?? undefined,
        organization: params.organizationId ?? undefined,
        eventSource: params.eventSourceId ?? undefined,
        importRun: params.importRunId ?? undefined,
        provider: params.provider,
        model: params.model,
        operationType: params.operationType,
        source: params.source,
        status: params.status ?? 'success',
        requestId: params.requestId,
        usageKind: params.usage.kind,
        inputTokens: params.usage.kind === 'tokens' ? params.usage.inputTokens : undefined,
        outputTokens: params.usage.kind === 'tokens' ? params.usage.outputTokens : undefined,
        cachedInputTokens:
          params.usage.kind === 'tokens' ? params.usage.cachedInputTokens : undefined,
        reasoningTokens: params.usage.kind === 'tokens' ? params.usage.reasoningTokens : undefined,
        totalTokens:
          params.usage.kind === 'tokens'
            ? params.usage.inputTokens + params.usage.outputTokens
            : undefined,
        searchUnits: params.usage.kind === 'search_units' ? params.usage.searchUnits : undefined,
        inputPricePerMTok: cost?.inputPricePerMTok,
        outputPricePerMTok: cost?.outputPricePerMTok,
        costUsd: cost?.costUsd,
      },
      overrideAccess: true,
    })
  } catch (error) {
    logger.error('Failed to record usage event', {
      event: 'usage.record_failed',
      operationType: params.operationType,
      provider: params.provider,
      model: params.model,
      municipalityId: params.municipalityId,
      usage: params.usage,
      ...serializeError(error),
    })
  }
}
