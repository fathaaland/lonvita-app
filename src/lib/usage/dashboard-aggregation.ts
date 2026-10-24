import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import type { SQL } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'

export type UsageDashboardFilters = {
  from: Date
  to: Date
  municipalityId?: number
  userId?: number
}

export type UsageDashboardSummary = {
  totalRequests: number
  totalCostUsd: number
  totalTokens: number
  /** Rows with `costUsd IS NULL` — pricing was unknown at write time, cost is NOT counted as $0. */
  unpricedCount: number
  successCount: number
  errorCount: number
  abortedCount: number
}

export type UsageDashboardTimeSeriesPoint = {
  date: string
  costUsd: number
  tokens: number
  requests: number
  unpricedCount: number
}

export type UsageDashboardModelBreakdown = {
  provider: string
  model: string
  costUsd: number
  tokens: number
  requests: number
  unpricedCount: number
}

export type UsageDashboardOperationBreakdown = {
  operationType: string
  costUsd: number
  tokens: number
  requests: number
  unpricedCount: number
}

/** One import (`import_runs`) — what it read and what its AI calls cost, for the log. */
export type UsageDashboardImportRun = {
  id: number
  startedAt: string
  municipalityName: string | null
  trigger: string
  status: string
  sourceUrl: string | null
  sourceLabel: string | null
  found: number
  created: number
  aiCalls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** The log shows the newest runs of the range; the totals above still cover all of it. */
const IMPORT_RUNS_LIMIT = 200

export type UsageDashboardData = {
  summary: UsageDashboardSummary
  timeSeries: UsageDashboardTimeSeriesPoint[]
  byModel: UsageDashboardModelBreakdown[]
  byOperationType: UsageDashboardOperationBreakdown[]
  importRuns: UsageDashboardImportRun[]
}

const buildWhereClause = (filters: UsageDashboardFilters): SQL => {
  const conditions: SQL[] = [
    sql`created_at >= ${filters.from.toISOString()}`,
    sql`created_at < ${filters.to.toISOString()}`,
  ]

  if (filters.municipalityId !== undefined) {
    conditions.push(sql`municipality_id = ${filters.municipalityId}`)
  }

  if (filters.userId !== undefined) {
    conditions.push(sql`user_id = ${filters.userId}`)
  }

  return sql.join(conditions, sql` AND `)
}

const buildImportRunsWhereClause = (filters: UsageDashboardFilters): SQL => {
  const conditions: SQL[] = [
    sql`r.started_at >= ${filters.from.toISOString()}`,
    sql`r.started_at < ${filters.to.toISOString()}`,
  ]

  if (filters.municipalityId !== undefined) {
    conditions.push(sql`r.municipality_id = ${filters.municipalityId}`)
  }

  if (filters.userId !== undefined) {
    conditions.push(sql`r.requested_by_id = ${filters.userId}`)
  }

  return sql.join(conditions, sql` AND `)
}

/**
 * Aggregates `usage_events` with raw SQL (`GROUP BY`) rather than `payload.find()` + JS
 * reduce, since the ledger is append-only and expected to grow indefinitely — fetching every
 * row to aggregate in JS would not scale. This bypasses Payload's access-control layer, which
 * is acceptable here because callers must already be gated as admin-only before reaching this
 * function (or, like the fair-use cap in lib/import/usage, be the system itself).
 */
export async function getUsageDashboardData(
  payload: Payload,
  filters: UsageDashboardFilters,
): Promise<UsageDashboardData> {
  const db = (payload.db as unknown as PostgresAdapter).drizzle
  const where = buildWhereClause(filters)

  const [summaryResult, timeSeriesResult, byModelResult, byOperationTypeResult, importRunsResult] =
    await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM(cost_usd), 0)::float8 AS total_cost_usd,
          COALESCE(SUM(total_tokens), 0)::float8 AS total_tokens,
          COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_count,
          COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
          COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
          COUNT(*) FILTER (WHERE status = 'aborted')::int AS aborted_count
        FROM usage_events
        WHERE ${where}
      `),
      db.execute(sql`
        SELECT
          -- Bucket by UTC days regardless of the session TimeZone (inherited from the
          -- server, never pinned) so buckets align with the UTC range filter above.
          to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
          COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
          COALESCE(SUM(total_tokens), 0)::float8 AS tokens,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_count
        FROM usage_events
        WHERE ${where}
        GROUP BY 1
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT
          provider,
          model,
          COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
          COALESCE(SUM(total_tokens), 0)::float8 AS tokens,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_count
        FROM usage_events
        WHERE ${where}
        GROUP BY provider, model
        ORDER BY cost_usd DESC
      `),
      db.execute(sql`
        SELECT
          operation_type,
          COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
          COALESCE(SUM(total_tokens), 0)::float8 AS tokens,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_count
        FROM usage_events
        WHERE ${where}
        GROUP BY operation_type
        ORDER BY cost_usd DESC
      `),
      db.execute(sql`
        SELECT
          r.id,
          r.started_at,
          m.name AS municipality_name,
          r.trigger,
          r.status,
          s.url AS source_url,
          s.label AS source_label,
          COALESCE(r.found, 0)::int AS found,
          COALESCE(r.created, 0)::int AS created,
          COALESCE(r.ai_calls, 0)::int AS ai_calls,
          COALESCE(r.input_tokens, 0)::float8 AS input_tokens,
          COALESCE(r.output_tokens, 0)::float8 AS output_tokens,
          COALESCE(r.cost_usd, 0)::float8 AS cost_usd
        FROM import_runs r
        LEFT JOIN municipalities m ON m.id = r.municipality_id
        LEFT JOIN event_sources s ON s.id = r.source_id
        WHERE ${buildImportRunsWhereClause(filters)}
        ORDER BY r.started_at DESC
        LIMIT ${IMPORT_RUNS_LIMIT}
      `),
    ])

  const summaryRow = summaryResult.rows[0] as
    | {
        total_requests: number
        total_cost_usd: number
        total_tokens: number
        unpriced_count: number
        success_count: number
        error_count: number
        aborted_count: number
      }
    | undefined

  const summary: UsageDashboardSummary = {
    totalRequests: summaryRow?.total_requests ?? 0,
    totalCostUsd: summaryRow?.total_cost_usd ?? 0,
    totalTokens: summaryRow?.total_tokens ?? 0,
    unpricedCount: summaryRow?.unpriced_count ?? 0,
    successCount: summaryRow?.success_count ?? 0,
    errorCount: summaryRow?.error_count ?? 0,
    abortedCount: summaryRow?.aborted_count ?? 0,
  }

  const timeSeries = (
    timeSeriesResult.rows as {
      date: string
      cost_usd: number
      tokens: number
      requests: number
      unpriced_count: number
    }[]
  ).map((row) => ({
    date: row.date,
    costUsd: row.cost_usd,
    tokens: row.tokens,
    requests: row.requests,
    unpricedCount: row.unpriced_count,
  }))

  const byModel = (
    byModelResult.rows as {
      provider: string
      model: string
      cost_usd: number
      tokens: number
      requests: number
      unpriced_count: number
    }[]
  ).map((row) => ({
    provider: row.provider,
    model: row.model,
    costUsd: row.cost_usd,
    tokens: row.tokens,
    requests: row.requests,
    unpricedCount: row.unpriced_count,
  }))

  const byOperationType = (
    byOperationTypeResult.rows as {
      operation_type: string
      cost_usd: number
      tokens: number
      requests: number
      unpriced_count: number
    }[]
  ).map((row) => ({
    operationType: row.operation_type,
    costUsd: row.cost_usd,
    tokens: row.tokens,
    requests: row.requests,
    unpricedCount: row.unpriced_count,
  }))

  const importRuns = (
    importRunsResult.rows as {
      id: number
      started_at: string | Date
      municipality_name: string | null
      trigger: string
      status: string
      source_url: string | null
      source_label: string | null
      found: number
      created: number
      ai_calls: number
      input_tokens: number
      output_tokens: number
      cost_usd: number
    }[]
  ).map((row) => ({
    id: row.id,
    startedAt: new Date(row.started_at).toISOString(),
    municipalityName: row.municipality_name,
    trigger: row.trigger,
    status: row.status,
    sourceUrl: row.source_url,
    sourceLabel: row.source_label,
    found: row.found,
    created: row.created,
    aiCalls: row.ai_calls,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
  }))

  return { summary, timeSeries, byModel, byOperationType, importRuns }
}
