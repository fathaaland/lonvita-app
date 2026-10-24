import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { pragueMonthStart } from '@/lib/import/usage'
import { getCostByMunicipality } from '@/lib/usage/dashboard-aggregation'
import { logger, serializeError } from '@/lib/logger'
import { relationNumber } from '@/lib/relations'

/**
 * Importing events across the platform, for its admins (the superadmin panel's Import tab): the AI
 * switch, and per obec its sources with how their reads go, what its AI calls cost this month
 * against its limit, and how many found events wait for its admins.
 *
 * GET /api/admin/import-overview
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const now = new Date()
    const [settings, municipalities, sources, pending, costs] = await Promise.all([
      payload.findGlobal({ slug: 'import-settings', depth: 0, overrideAccess: true }),
      payload.find({
        collection: 'municipalities',
        select: { name: true, importAiBudgetUsd: true },
        depth: 0,
        pagination: false,
        sort: 'name',
        overrideAccess: true,
      }),
      payload.find({
        collection: 'event-sources',
        // Organizers' sources from before import became the obec's alone aren't read any more.
        where: { organization: { exists: false } },
        depth: 0,
        pagination: false,
        sort: 'createdAt',
        overrideAccess: true,
      }),
      payload.find({
        collection: 'event-import-candidates',
        where: {
          and: [
            { status: { equals: 'pending' } },
            { startsAt: { greater_than: now.toISOString() } },
            { organization: { exists: false } },
          ],
        },
        select: { municipality: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
      getCostByMunicipality(payload, { from: pragueMonthStart(now), to: now }),
    ])

    const pendingBy = new Map<number, number>()
    for (const c of pending.docs) {
      const id = relationNumber(c.municipality)
      if (id) pendingBy.set(id, (pendingBy.get(id) ?? 0) + 1)
    }

    return NextResponse.json({
      aiEnabled: settings.aiEnabled !== false,
      defaultBudgetUsd: IMPORT_LIMITS.aiMonthlyBudgetUsd,
      municipalities: municipalities.docs.map((m) => ({
        id: m.id,
        name: m.name,
        budgetUsd: m.importAiBudgetUsd ?? null,
        spentUsd: costs.get(m.id) ?? 0,
        pendingCandidates: pendingBy.get(m.id) ?? 0,
        sources: sources.docs.filter((s) => relationNumber(s.municipality) === m.id),
      })),
    })
  } catch (error) {
    logger.error('Import overview failed', { event: 'import.overview_failed', ...serializeError(error) })
    return NextResponse.json({ error: 'Přehled se nepodařilo načíst.' }, { status: 500 })
  }
}
