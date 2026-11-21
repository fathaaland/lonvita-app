import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { licencePeriodOf } from '@/lib/billing/period'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'
import { relationNumber } from '@/lib/relations'

/**
 * Who of the obec used how much of the packages it bought for the licence year — SMS parts, the AI
 * reads of the event import, and the sources switched on. The obec's own use (its admins' imports,
 * its own events' cancellations) is one row; each organizer's organization another. Only this obec's
 * own: everything is charged to the obec of the event or source it was done for, and a ledger row
 * never keeps an organization of another obec (lib/billing/attribution) — a mikroregion shares
 * nothing here, each obec and its organizers use only that obec's package. What the obec does about
 * it is its own business: nothing here limits anyone beyond the obec's package itself.
 *
 * Read off the ledgers (sms-messages, usage-events) and the sources as they are now. SMS from before
 * the ledger kept whose they were make the "unattributed" row.
 */

export type PackageUsageRow = {
  /** `obec` — the obec itself; `organization` — an organizer's; `unattributed` — SMS from before. */
  kind: 'obec' | 'organization' | 'unattributed'
  organizationId: number | null
  name: string
  /** The organizer who owns it — for an organization only. */
  ownerName: string | null
  smsParts: number
  smsOverageParts: number
  aiRuns: number
  aiCalls: number
  aiTokens: number
  enabledSources: number
}

export type PackageUsage = {
  periodStart: string
  periodEnd: string
  totals: { smsParts: number; aiRuns: number; aiCalls: number; aiTokens: number; enabledSources: number }
  rows: PackageUsageRow[]
}

type Key = string
const OBEC: Key = 'obec'
const UNATTRIBUTED: Key = 'unattributed'

export async function getPackageUsage(payload: Payload, municipalityId: number, now: Date): Promise<PackageUsage> {
  const municipality = await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
    select: { name: true, licencePeriodStart: true, licencePeriodEnd: true, licencePaidUntil: true },
  })
  const period = licencePeriodOf(municipality, now)
  const from = period.start.toISOString()
  const to = period.end.toISOString()
  const db = payload.db.drizzle

  // Summed in the database — a year of an obec's SMS and AI calls is thousands of rows.
  const [sms, ai, sources] = await Promise.all([
    db.execute<{ organization_id: number | null; parts: string; overage_parts: string }>(sql`
      SELECT organization_id,
        COALESCE(SUM(COALESCE(parts, 1)), 0) AS parts,
        COALESCE(SUM(COALESCE(parts, 1)) FILTER (WHERE overage), 0) AS overage_parts
      FROM sms_messages
      WHERE municipality_id = ${municipalityId} AND created_at >= ${from} AND created_at < ${to}
      GROUP BY organization_id
    `),
    db.execute<{ organization_id: number | null; runs: string; calls: string; tokens: string }>(sql`
      SELECT organization_id,
        COUNT(DISTINCT import_run_id) AS runs,
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
      FROM usage_events
      WHERE municipality_id = ${municipalityId} AND created_at >= ${from} AND created_at < ${to}
      GROUP BY organization_id
    `),
    db.execute<{ organization_id: number | null; enabled: string }>(sql`
      SELECT organization_id, COUNT(*) AS enabled
      FROM event_sources
      WHERE municipality_id = ${municipalityId} AND enabled = true
      GROUP BY organization_id
    `),
  ])

  const organizationIds = [
    ...new Set(
      [...sms.rows, ...ai.rows, ...sources.rows]
        .map((r) => relationNumber(r.organization_id))
        .filter((id): id is number => id !== null),
    ),
  ]
  const organizations =
    organizationIds.length > 0
      ? (
          await payload.find({
            collection: 'organizations',
            where: { id: { in: organizationIds } },
            select: { name: true, type: true, owner: true, municipality: true },
            depth: 0,
            pagination: false,
            overrideAccess: true,
          })
        ).docs
      : []
  const byId = new Map(organizations.map((o) => [o.id, o]))

  const ownerIds = [
    ...new Set(organizations.map((o) => relationNumber(o.owner)).filter((id): id is number => id !== null)),
  ]
  const profiles =
    ownerIds.length > 0
      ? await payload.find({
          collection: 'profiles',
          where: { user: { in: ownerIds } },
          select: { user: true, fullName: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : { docs: [] as { user: unknown; fullName?: string | null }[] }
  const ownerNames = new Map(profiles.docs.map((p) => [relationNumber(p.user), p.fullName ?? null]))

  /** The obec's own organization is the obec — its events' SMS and its admins' imports are one row. */
  const keyOf = (organizationId: number | null, ledger: 'sms' | 'other'): Key => {
    if (organizationId === null) return ledger === 'sms' ? UNATTRIBUTED : OBEC
    const organization = byId.get(organizationId)
    return organization?.type === MUNICIPALITY_ORGANIZATION_TYPE && relationNumber(organization.municipality) === municipalityId
      ? OBEC
      : String(organizationId)
  }

  const rows = new Map<Key, PackageUsageRow>()
  const rowFor = (key: Key): PackageUsageRow => {
    let row = rows.get(key)
    if (row) return row
    const organization = key === OBEC || key === UNATTRIBUTED ? null : byId.get(Number(key))
    const ownerId = relationNumber(organization?.owner)
    row = {
      kind: key === OBEC ? 'obec' : key === UNATTRIBUTED ? 'unattributed' : 'organization',
      organizationId: organization?.id ?? null,
      name:
        key === OBEC
          ? `Obec ${municipality.name}`
          : key === UNATTRIBUTED
            ? 'Bez přiřazení (SMS odeslané před evidencí po organizátorech)'
            : (organization?.name ?? 'Smazaná organizace'),
      ownerName: ownerId !== null ? (ownerNames.get(ownerId) ?? null) : null,
      smsParts: 0,
      smsOverageParts: 0,
      aiRuns: 0,
      aiCalls: 0,
      aiTokens: 0,
      enabledSources: 0,
    }
    rows.set(key, row)
    return row
  }
  for (const r of sms.rows) {
    const row = rowFor(keyOf(relationNumber(r.organization_id), 'sms'))
    row.smsParts += Number(r.parts)
    row.smsOverageParts += Number(r.overage_parts)
  }
  for (const r of ai.rows) {
    const row = rowFor(keyOf(relationNumber(r.organization_id), 'other'))
    row.aiRuns += Number(r.runs)
    row.aiCalls += Number(r.calls)
    row.aiTokens += Number(r.tokens)
  }
  for (const r of sources.rows) rowFor(keyOf(relationNumber(r.organization_id), 'other')).enabledSources += Number(r.enabled)

  const list = [...rows.values()]
  const order = { obec: 0, organization: 1, unattributed: 2 } as const
  list.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      b.smsParts + b.aiCalls + b.enabledSources - (a.smsParts + a.aiCalls + a.enabledSources) ||
      a.name.localeCompare(b.name, 'cs'),
  )
  const sum = (pick: (r: PackageUsageRow) => number) => list.reduce((total, r) => total + pick(r), 0)
  return {
    periodStart: from,
    periodEnd: period.paidEnd.toISOString(),
    totals: {
      smsParts: sum((r) => r.smsParts),
      aiRuns: sum((r) => r.aiRuns),
      aiCalls: sum((r) => r.aiCalls),
      aiTokens: sum((r) => r.aiTokens),
      enabledSources: sum((r) => r.enabledSources),
    },
    rows: list,
  }
}
