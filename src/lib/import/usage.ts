import type { Payload } from 'payload'

import { computeUsageCost, getUsagePricing } from '@/lib/providers/usage-pricing'
import { getCostByMunicipality } from '@/lib/usage/dashboard-aggregation'
import { recordUsageEvent } from '@/lib/usage/record-usage'
import { logger } from '@/lib/logger'

import {
  ImportAiError,
  importModel,
  type AiMeter,
  type extractEventDetailsWithAi,
  type extractEventsWithAi,
} from './ai'
import { IMPORT_LIMITS } from './contracts'
import { pragueToday, pragueWallTimeToIso } from './time'

/**
 * The imports' AI calls on the usage-events ledger (lib/usage — the same accounting hbai-app uses),
 * each counted against the obec. Obce pay a flat fee for imports: the ledger is what their imports
 * cost us, and the fair-use cap (IMPORT_LIMITS.aiMonthlyBudgetUsd) is read off it.
 */

/** Whose import a call was made for. */
export type UsageAttribution = {
  municipality: number
  user?: number | null
  eventSource?: number | null
  importRun?: number | null
}

/** What a run's calls added up to — kept on the run (ImportRuns). */
export type UsageTotals = {
  aiCalls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export const emptyTotals = (): UsageTotals => ({
  aiCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
})

/** The start of the calendar month `now` falls in, in Prague. */
export const pragueMonthStart = (now: Date): Date =>
  new Date(pragueWallTimeToIso(`${pragueToday(now).slice(0, 7)}-01`, null))

/** What an obec's imports may spend on the AI this month — its own limit when the platform gave it
 * one (Municipalities.importAiBudgetUsd), else IMPORT_LIMITS.aiMonthlyBudgetUsd. */
export const aiBudgetOf = (municipality: { importAiBudgetUsd?: number | null }): number =>
  municipality.importAiBudgetUsd ?? IMPORT_LIMITS.aiMonthlyBudgetUsd

export async function isOverAiBudget(
  payload: Payload,
  municipality: { id: number; aiBudgetUsd: number },
  now: Date,
): Promise<boolean> {
  const spent = await getCostByMunicipality(payload, {
    from: pragueMonthStart(now),
    to: new Date(now.getTime() + 1),
    municipalityId: municipality.id,
  })
  return (spent.get(municipality.id) ?? 0) >= municipality.aiBudgetUsd
}

/** Whether the platform's admins switched AI reads off for everybody (ImportSettings). */
export async function isAiSwitchedOff(payload: Payload): Promise<boolean> {
  const settings = await payload
    .findGlobal({ slug: 'import-settings', depth: 0, overrideAccess: true })
    .catch(() => null)
  return settings?.aiEnabled === false
}

const REFUSALS = {
  over_budget:
    'Měsíční limit AI zpracování obce je vyčerpaný — do konce měsíce se čtou jen kalendáře iCal a strukturovaná data.',
  disabled:
    'Zpracování pomocí AI je dočasně vypnuté — zatím se čtou jen kalendáře iCal a strukturovaná data.',
  unpriced:
    'Zpracování pomocí AI je dočasně mimo provoz — zatím se čtou jen kalendáře iCal a strukturovaná data.',
  not_subscribed:
    'Obec nemá objednané zpracování pomocí AI — čtou se jen kalendáře iCal a strukturovaná data.',
} as const

/** Why the AI isn't asked — the obec not paying for it, its limit, the platform's switch, a model with no price — not the
 * source's fault: such a run is skipped, not counted as the source failing (import-events.processor). */
export const isAiHeldBack = (error: unknown): boolean =>
  error instanceof ImportAiError &&
  (error.code === 'over_budget' ||
    error.code === 'disabled' ||
    error.code === 'unpriced' ||
    error.code === 'not_subscribed' ||
    error.code === 'not_configured')

export type AiRefusal = keyof typeof REFUSALS

/** Why the AI may not be called for the obec right now — or null when it may. A model the ledger
 * has no price for (IMPORT_AI_MODEL set to one usage-pricing doesn't list) would cost $0 on it, and
 * the obec's limit would never be reached — so it isn't called at all. */
export async function aiRefusalFor(
  payload: Payload,
  municipality: { id: number; aiBudgetUsd: number; aiEnabled: boolean },
  now: Date,
): Promise<AiRefusal | null> {
  if (!municipality.aiEnabled) return 'not_subscribed'
  if (await isAiSwitchedOff(payload)) return 'disabled'
  if (!getUsagePricing('anthropic', importModel())) {
    logger.error('Import AI model has no price', {
      event: 'import.ai_model_unpriced',
      model: importModel(),
    })
    return 'unpriced'
  }
  if (await isOverAiBudget(payload, municipality, now)) return 'over_budget'
  return null
}

type MeteredAi = {
  extractWithAi: (
    input: Parameters<typeof extractEventsWithAi>[0],
    context: Parameters<typeof extractEventsWithAi>[1],
  ) => ReturnType<typeof extractEventsWithAi>
  extractDetailsWithAi: typeof extractEventDetailsWithAi
}

/**
 * The AI of `deps`, with every call written to the ledger against `attribution` (and added to
 * `totals`). Over the obec's monthly budget, or with AI switched off for the platform, it isn't
 * called at all — the import goes on with what needs no AI.
 */
export function meterAi<D extends MeteredAi>(
  deps: D,
  payload: Payload,
  attribution: UsageAttribution,
  { refusal, totals }: { refusal: AiRefusal | null; totals: UsageTotals },
): D {
  const meter: AiMeter = async (call) => {
    const usage = {
      kind: 'tokens' as const,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cachedInputTokens: call.cachedInputTokens,
    }
    totals.aiCalls++
    totals.inputTokens += call.inputTokens
    totals.outputTokens += call.outputTokens
    totals.costUsd +=
      computeUsageCost(usage, getUsagePricing('anthropic', call.model))?.costUsd ?? 0
    await recordUsageEvent(payload, {
      municipalityId: attribution.municipality,
      userId: attribution.user,
      eventSourceId: attribution.eventSource,
      importRunId: attribution.importRun,
      provider: 'anthropic',
      model: call.model,
      operationType: call.purpose === 'details' ? 'event_import_details' : 'event_import',
      source: 'worker',
      status: call.status,
      requestId: call.requestId ?? undefined,
      usage,
    })
  }
  const refuse = (): never => {
    throw new ImportAiError(REFUSALS[refusal!], refusal!)
  }
  return {
    ...deps,
    extractWithAi: async (input, context) =>
      refusal ? refuse() : deps.extractWithAi(input, { ...context, meter }),
    extractDetailsWithAi: async (text, event, context) =>
      refusal ? refuse() : deps.extractDetailsWithAi(text, event, { ...context, meter }),
  }
}
