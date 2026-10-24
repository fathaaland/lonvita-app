/** Pricing for a token-billed model, USD per 1,000,000 tokens. */
export type TokenUsagePricing = {
  unit: 'tokens'
  inputPerMTok: number
  outputPerMTok: number
  cachedInputPerMTok?: number
}

/** Pricing for a model billed per search/rerank unit rather than tokens (e.g. Cohere rerank). */
export type SearchUnitUsagePricing = {
  unit: 'search_units'
  pricePerSearchUnit: number
}

export type UsagePricing = TokenUsagePricing | SearchUnitUsagePricing

type UsagePricingEntry = {
  provider: string
  model: string
  pricing: UsagePricing
}

/**
 * Pricing for every provider:model pair called anywhere in the app (ported from hbai-app). The
 * imports default to Claude Haiku 5.5; IMPORT_AI_MODEL may point them at another one.
 */
const USAGE_PRICING: UsagePricingEntry[] = [
  {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    // Verified against Anthropic's pricing (prompts up to 100K tokens — the imports stay under it).
    pricing: { unit: 'tokens', inputPerMTok: 0.1, outputPerMTok: 0.5, cachedInputPerMTok: 0.01 },
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    // Verified against Anthropic's pricing.
    pricing: { unit: 'tokens', inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2 },
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    // Verified against Anthropic's pricing.
    pricing: { unit: 'tokens', inputPerMTok: 4, outputPerMTok: 20, cachedInputPerMTok: 0.2 },
  },
]

/** Returns pricing for a provider:model pair, or undefined when pricing is unknown. */
export function getUsagePricing(provider: string, model: string): UsagePricing | undefined {
  return USAGE_PRICING.find((entry) => entry.provider === provider && entry.model === model)
    ?.pricing
}

export type TokenUsageAmount = {
  kind: 'tokens'
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** Informational only — reasoning tokens are billed as part of `outputTokens`, not priced separately. */
  reasoningTokens?: number
}

export type SearchUnitsUsageAmount = {
  kind: 'search_units'
  searchUnits: number
}

export type UsageAmount = TokenUsageAmount | SearchUnitsUsageAmount

export type UsageCostResult = {
  costUsd: number
  inputPricePerMTok?: number
  outputPricePerMTok?: number
}

/** Computes USD cost for a usage amount, or null when pricing is unknown / mismatched. */
export function computeUsageCost(
  usage: UsageAmount,
  pricing: UsagePricing | undefined,
): UsageCostResult | null {
  if (!pricing) return null

  if (usage.kind === 'tokens') {
    if (pricing.unit !== 'tokens') return null

    const cachedInputTokens = usage.cachedInputTokens ?? 0
    const billableInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0)
    const inputCost = (billableInputTokens / 1_000_000) * pricing.inputPerMTok
    // Models without a configured cache discount must bill cached reads at the full
    // input rate — falling back to 0 would make cached tokens free in the ledger.
    const cachedCost =
      (cachedInputTokens / 1_000_000) * (pricing.cachedInputPerMTok ?? pricing.inputPerMTok)
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMTok

    return {
      costUsd: inputCost + cachedCost + outputCost,
      inputPricePerMTok: pricing.inputPerMTok,
      outputPricePerMTok: pricing.outputPerMTok,
    }
  }

  if (pricing.unit !== 'search_units') return null

  return { costUsd: usage.searchUnits * pricing.pricePerSearchUnit }
}
