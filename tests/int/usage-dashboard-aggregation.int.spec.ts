// @vitest-environment node
import { getUsageDashboardData } from '@/lib/usage/dashboard-aggregation'
import { recordUsageEvent } from '@/lib/usage/record-usage'
import config from '@/payload.config'
import { getPayload, Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Ported from hbai-app (tenant → obec).
let payload: Payload
let municipalityId: number

describe('usage dashboard aggregation', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    const municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Usage Dashboard Test Obec ${Date.now()}`,
        lat: 49.5,
        lng: 15.9,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
      },
      overrideAccess: true,
    })
    municipalityId = municipality.id

    const rows = [
      {
        municipality: municipalityId,
        provider: 'anthropic',
        model: 'claude-3',
        operationType: 'event_import' as const,
        source: 'worker' as const,
        usageKind: 'tokens' as const,
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0.01,
        status: 'success' as const,
      },
      {
        municipality: municipalityId,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        operationType: 'event_import_details' as const,
        source: 'worker' as const,
        usageKind: 'tokens' as const,
        inputTokens: 2000,
        outputTokens: 0,
        totalTokens: 2000,
        costUsd: 0.02,
        status: 'success' as const,
      },
      {
        municipality: municipalityId,
        provider: 'cohere',
        model: 'rerank-v3.5',
        operationType: 'event_import' as const,
        source: 'worker' as const,
        usageKind: 'search_units' as const,
        searchUnits: 10,
        costUsd: null,
        status: 'success' as const,
      },
      {
        municipality: municipalityId,
        provider: 'anthropic',
        model: 'claude-3',
        operationType: 'event_import' as const,
        source: 'api' as const,
        usageKind: 'tokens' as const,
        inputTokens: 100,
        outputTokens: 0,
        totalTokens: 100,
        costUsd: null,
        status: 'error' as const,
      },
    ]

    for (const data of rows) {
      await payload.create({
        collection: 'usage-events',
        data,
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    await payload.delete({
      collection: 'usage-events',
      where: { municipality: { equals: municipalityId } },
      overrideAccess: true,
    })
    await payload.delete({ collection: 'municipalities', id: municipalityId, overrideAccess: true })
  })

  it('aggregates summary, time series, and breakdowns scoped to an obec', async () => {
    const from = new Date()
    from.setUTCHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setUTCDate(to.getUTCDate() + 1)

    const data = await getUsageDashboardData(payload, { from, to, municipalityId })

    expect(data.summary.totalRequests).toBe(4)
    expect(data.summary.totalCostUsd).toBeCloseTo(0.03, 5)
    expect(data.summary.totalTokens).toBe(3600)
    expect(data.summary.unpricedCount).toBe(2)
    expect(data.summary.successCount).toBe(3)
    expect(data.summary.errorCount).toBe(1)
    expect(data.summary.abortedCount).toBe(0)

    expect(data.timeSeries).toHaveLength(1)
    expect(data.timeSeries[0].requests).toBe(4)
    expect(data.timeSeries[0].unpricedCount).toBe(2)
    expect(data.timeSeries[0].costUsd).toBeCloseTo(0.03, 5)

    const claude = data.byModel.find(
      (row) => row.provider === 'anthropic' && row.model === 'claude-3',
    )
    expect(claude).toBeDefined()
    expect(claude?.requests).toBe(2)
    expect(claude?.unpricedCount).toBe(1)
    expect(claude?.costUsd).toBeCloseTo(0.01, 5)

    const rerank = data.byModel.find((row) => row.provider === 'cohere')
    expect(rerank?.unpricedCount).toBe(1)
    expect(rerank?.costUsd).toBe(0)

    expect(data.byOperationType.map((row) => row.operationType).sort()).toEqual(
      ['event_import', 'event_import_details'].sort(),
    )
  })

  it('scopes results down to a single user when userId is provided', async () => {
    const from = new Date()
    from.setUTCHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setUTCDate(to.getUTCDate() + 1)

    const data = await getUsageDashboardData(payload, {
      from,
      to,
      municipalityId,
      userId: 999999999, // no rows belong to this user, so this should yield an empty result
    })

    expect(data.summary.totalRequests).toBe(0)
    expect(data.summary.totalCostUsd).toBe(0)
    expect(data.byModel).toHaveLength(0)
  })

  it('records a call at the price of the day — cached input at its own rate', async () => {
    await recordUsageEvent(payload, {
      municipalityId,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      operationType: 'event_import',
      source: 'worker',
      usage: {
        kind: 'tokens',
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cachedInputTokens: 500_000,
      },
    })
    const [row] = (
      await payload.find({
        collection: 'usage-events',
        where: {
          and: [
            { municipality: { equals: municipalityId } },
            { inputTokens: { equals: 1_000_000 } },
          ],
        },
        overrideAccess: true,
      })
    ).docs
    // Over 100K input tokens Haiku 5.5 bills the whole call at 5×: 500k fresh × $0.50 + 500k cached
    // × $0.01 + 100k out × $2.50 per million.
    expect(row.costUsd).toBeCloseTo(0.25 + 0.005 + 0.25, 6)
    expect(row.inputPricePerMTok).toBe(0.5)
    expect(row.outputPricePerMTok).toBe(2.5)
    expect(row.totalTokens).toBe(1_100_000)
    expect(row.status).toBe('success')
  })
})
