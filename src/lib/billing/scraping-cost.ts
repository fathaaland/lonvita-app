import { sql } from '@payloadcms/db-postgres'
import { Redis } from 'ioredis'
import type { Payload } from 'payload'

import { getPlatformDeciders, sendNotificationToMany } from '@/collections/shared/notify'
import { logger, serializeError } from '@/lib/logger'
import { queueConnectionOptions } from '@/lib/valkey/client'

import { getBillingCatalog } from './catalog'
import { monthRange, pragueMonthKey } from './period'
import { scrapingLimitsOf } from './scraping'

/**
 * What the import AI cost the platform, per obec — the usage-events ledger (every call metered by
 * lib/import/usage), in USD. Never billed: an obec pays for its package (sources, frequency), not for
 * tokens. This is how the platform sees its margin, and notices an obec whose runs cost far more than
 * they should (a page that grew, a source read over and over) — nothing is blocked for it.
 */
export async function importAiCostUsd(
  payload: Payload,
  from: Date,
  to: Date,
  municipalityId?: number,
): Promise<Map<number, number>> {
  const { rows } = await payload.db.drizzle.execute<{ municipality_id: number; cost: string | null }>(sql`
    SELECT municipality_id, COALESCE(SUM(cost_usd), 0) AS cost
    FROM usage_events
    WHERE created_at >= ${from.toISOString()}
      AND created_at < ${to.toISOString()}
      AND municipality_id IS NOT NULL
      ${municipalityId !== undefined ? sql`AND municipality_id = ${municipalityId}` : sql``}
    GROUP BY municipality_id
  `)
  return new Map(rows.map((r) => [Number(r.municipality_id), Number(r.cost ?? 0)]))
}

let client: Redis | undefined
const getClient = (): Redis => {
  if (!client) {
    client = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    client.on('error', () => undefined)
  }
  return client
}

/** Days a month's "already told" mark is kept — past the month's end, never into the next one's. */
const ALERT_TTL_SECONDS = 40 * 24 * 60 * 60

/**
 * After an import run: if the obec's AI cost this month has passed what its package should cost
 * (BillingSettings.scrapingCostAlertUsdPerSource × the sources it may have), the platform's admins
 * hear it — once a month per obec. Never throws.
 */
export async function checkScrapingCost(payload: Payload, municipalityId: number, now: Date): Promise<void> {
  try {
    const month = pragueMonthKey(now)
    const { from, to } = monthRange(month)
    const [costs, limits, catalog] = await Promise.all([
      importAiCostUsd(payload, from, to, municipalityId),
      scrapingLimitsOf(payload, municipalityId),
      getBillingCatalog(payload),
    ])
    const cost = costs.get(municipalityId) ?? 0
    const threshold = catalog.scrapingCostAlertUsdPerSource * Math.max(1, limits.maxSources)
    if (threshold <= 0 || cost < threshold) return
    // Once a month — and only if Redis says it wasn't told yet; without Redis, nobody is spammed.
    const fresh = await getClient()
      .set(`lonvita:scraping-cost-alert:${municipalityId}:${month}`, '1', 'EX', ALERT_TTL_SECONDS, 'NX')
      .catch(() => null)
    if (fresh !== 'OK') return

    const obec = await payload.findByID({
      collection: 'municipalities',
      id: municipalityId,
      depth: 0,
      overrideAccess: true,
      select: { name: true },
    })
    const { userIds } = await getPlatformDeciders(payload)
    await sendNotificationToMany(payload, userIds, {
      title: 'Scraping: neobvykle vysoké náklady',
      link: `/superadmin/obce/${municipalityId}`,
      message:
        `Import akcí obce ${obec.name} stál tento měsíc $${cost.toFixed(2)} za AI ` +
        `(práh $${threshold.toFixed(2)} = ${limits.maxSources} zdrojů × $${catalog.scrapingCostAlertUsdPerSource}). ` +
        'Obci se nic neblokuje — zkontrolujte v logu běhů, který zdroj běží často nebo je příliš velký.',
    })
    logger.warn('Import AI cost of an obec past its threshold', {
      event: 'import.cost_alert',
      municipalityId,
      costUsd: cost,
      thresholdUsd: threshold,
    })
  } catch (error) {
    logger.warn('Scraping cost check failed', { event: 'import.cost_check_failed', municipalityId, ...serializeError(error) })
  }
}
