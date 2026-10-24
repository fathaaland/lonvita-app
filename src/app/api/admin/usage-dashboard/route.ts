import { NextResponse } from 'next/server'

import { getUsageDashboardData } from '@/lib/usage/dashboard-aggregation'
import { logger, serializeError } from '@/lib/logger'
import config from '@payload-config'
import { getPayload } from 'payload'

import type { NextRequest } from 'next/server'

const DEFAULT_RANGE_DAYS = 30

const parseDate = (value: string | null): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// The aggregation query treats the range end as exclusive, so a bare date
// (e.g. "2026-07-21") is bumped to the start of the next UTC day to include that
// whole day. Full ISO timestamps (what the dashboard client sends) pass through as-is.
const parseRangeEnd = (value: string | null): Date | null => {
  if (!value) return null
  const parsed = parseDate(value)
  if (!parsed) return null
  if (BARE_DATE_RE.test(value)) parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed
}

const parseId = (value: string | null): number | undefined => {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * The Usage & Cost Dashboard's data (ported from hbai-app) — what the AI calls in `usage-events`
 * cost, per obec and user. Platform admins only.
 *
 * GET /api/admin/usage-dashboard?from&to&municipalityId&userId
 */
export async function GET(request: NextRequest) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })

  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)

  const now = new Date()
  const defaultFrom = new Date(now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)

  const from = parseDate(searchParams.get('from')) ?? defaultFrom
  const to = parseRangeEnd(searchParams.get('to')) ?? now
  const municipalityId = parseId(searchParams.get('municipalityId'))
  const userId = parseId(searchParams.get('userId'))

  try {
    const data = await getUsageDashboardData(payload, { from, to, municipalityId, userId })

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      ...data,
    })
  } catch (error) {
    logger.error('Failed to load usage dashboard data', {
      event: 'usage.dashboard_failed',
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Failed to load usage dashboard data' }, { status: 500 })
  }
}
