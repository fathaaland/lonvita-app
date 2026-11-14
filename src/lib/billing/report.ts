import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { relationNumber } from '@/lib/relations'
import {
  getMunicipalityServices,
  type MunicipalityServices,
} from '@/lib/services/municipality-services'

import { listActiveUserSnapshots, type ActiveUserSnapshot } from './active-users'
import { PACKAGE_LABELS } from './catalog'
import { monthRange } from './period'
import { importAiCostUsd } from './scraping-cost'
import { countSmsParts } from './sms'
import { billingStatusOf, erasureConfirmed, type BillingStatus } from './status'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * What the superadmin bills from (Balíčky služeb: "Fakturaci dělám ručně, superadmin mi dává jen
 * podklady") — one obec in detail, and every obec for a month (the overview and its CSV).
 */

const namesOf = async (payload: Payload, userIds: number[]): Promise<Map<number, string>> => {
  if (userIds.length === 0) return new Map()
  const [users, profiles] = await Promise.all([
    payload.find({
      collection: 'users',
      where: { id: { in: userIds } },
      select: { email: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'profiles',
      where: { user: { in: userIds } },
      select: { user: true, fullName: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])
  const names = new Map<number, string>()
  for (const u of users.docs) names.set(u.id, u.email)
  for (const p of profiles.docs) {
    const id = relationNumber(p.user)
    if (id !== null && p.fullName?.trim()) names.set(id, p.fullName.trim())
  }
  return names
}

export type BillingSource = {
  id: number
  url: string
  label: string
  enabled: boolean
  lastRunAt: string | null
  lastError: string | null
  createdAt: string
  createdBy: string | null
}

export type BillingRun = {
  id: number
  startedAt: string
  source: string | null
  trigger: string
  status: string
  found: number
  created: number
  inputTokens: number
  outputTokens: number
  error: string | null
  errorCode: string | null
  reviewStatus: 'ok' | 'problem' | null
  reviewNote: string | null
}

export type BillingAuditEntry = {
  id: number
  at: string
  actor: string | null
  changes: Record<string, { from: unknown; to: unknown }>
}

export type BillingSettingsOfObec = {
  name: string
  billingStatus: BillingStatus
  billingNote: string | null
  licencePeriodStart: string | null
  licencePeriodEnd: string | null
  licencePaidUntil: string | null
  licenceTier: number | null
  licenceCustomYearlyCzk: number | null
  implementationFeeCzk: number | null
  smsEnabled: boolean
  smsPackage: string
  smsQuotaOverride: number | null
  importAiEnabled: boolean
  scrapingPackage: string
  scrapingMaxSourcesOverride: number | null
  scrapingSlotDay: number
  scrapingSlotHour: number
  scrapingFrequency: 'weekly' | 'twice_weekly'
  scrapingMaxInputTokensOverride: number | null
}

export type BillingDetail = {
  settings: BillingSettingsOfObec
  /** The platform has confirmed the obec's erasure for its current terminated stage. */
  erasureConfirmed: boolean
  services: MunicipalityServices
  snapshots: ActiveUserSnapshot[]
  sources: BillingSource[]
  runs: BillingRun[]
  audit: BillingAuditEntry[]
}

export async function billingDetailOf(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<BillingDetail> {
  const m = await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
  })
  const [services, snapshots, sources, runs, audit] = await Promise.all([
    getMunicipalityServices(payload, municipalityId, now),
    listActiveUserSnapshots(payload, municipalityId, 12),
    payload.find({
      collection: 'event-sources',
      where: {
        and: [{ municipality: { equals: municipalityId } }, { organization: { exists: false } }],
      },
      sort: 'createdAt',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'import-runs',
      where: { municipality: { equals: municipalityId } },
      sort: '-startedAt',
      depth: 0,
      limit: 100,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { targetCollection: { equals: 'municipalities' } },
          { targetId: { equals: String(municipalityId) } },
          { action: { equals: 'municipalities.billing-change' } },
        ],
      },
      sort: '-createdAt',
      depth: 0,
      limit: 50,
      overrideAccess: true,
    }),
  ])

  const people = await namesOf(payload, [
    ...new Set(
      [
        ...sources.docs.map((s) => relationNumber(s.createdBy)),
        ...audit.docs.map((a) => relationNumber(a.actor)),
      ].filter((id): id is number => id !== null),
    ),
  ])
  const sourceLabel = new Map(sources.docs.map((s) => [s.id, s.label || s.url]))

  return {
    erasureConfirmed: erasureConfirmed(m.billingStatus, m.billingStatusChangedAt, m.erasureConfirmedStage),
    settings: {
      name: m.name,
      billingStatus: billingStatusOf(m.billingStatus),
      billingNote: m.billingNote ?? null,
      licencePeriodStart: m.licencePeriodStart ?? null,
      licencePeriodEnd: m.licencePeriodEnd ?? null,
      licencePaidUntil: m.licencePaidUntil ?? null,
      licenceTier: m.licenceTier ?? null,
      licenceCustomYearlyCzk: m.licenceCustomYearlyCzk ?? null,
      implementationFeeCzk: m.implementationFeeCzk ?? null,
      smsEnabled: m.smsEnabled === true,
      smsPackage: m.smsPackage ?? 's',
      smsQuotaOverride: m.smsQuotaOverride ?? null,
      importAiEnabled: m.importAiEnabled === true,
      scrapingPackage: m.scrapingPackage ?? 's',
      scrapingMaxSourcesOverride: m.scrapingMaxSourcesOverride ?? null,
      scrapingSlotDay: m.scrapingSlotDay ?? 1,
      scrapingSlotHour: m.scrapingSlotHour ?? 2,
      scrapingFrequency: m.scrapingFrequency === 'twice_weekly' ? 'twice_weekly' : 'weekly',
      scrapingMaxInputTokensOverride: m.scrapingMaxInputTokensOverride ?? null,
    },
    services,
    snapshots,
    sources: sources.docs.map((s) => {
      const by = relationNumber(s.createdBy)
      return {
        id: s.id,
        url: s.url,
        label: s.label || s.url,
        enabled: s.enabled === true,
        lastRunAt: s.lastRunAt ?? null,
        lastError: s.lastError ?? null,
        createdAt: s.createdAt,
        createdBy: by === null ? null : (people.get(by) ?? null),
      }
    }),
    runs: runs.docs.map((r) => {
      const sourceId = relationNumber(r.source)
      return {
        id: r.id,
        startedAt: r.startedAt,
        source: sourceId === null ? null : (sourceLabel.get(sourceId) ?? `#${sourceId}`),
        trigger: r.trigger,
        status: r.status,
        found: r.found ?? 0,
        created: r.created ?? 0,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        error: r.error ?? null,
        errorCode: r.errorCode ?? null,
        reviewStatus: r.reviewStatus ?? null,
        reviewNote: r.reviewNote ?? null,
      }
    }),
    audit: audit.docs.map((a) => {
      const actor = relationNumber(a.actor)
      const metadata = (a.metadata ?? {}) as { changes?: BillingAuditEntry['changes'] }
      return {
        id: a.id,
        at: a.createdAt,
        actor: actor === null ? null : (people.get(actor) ?? `#${actor}`),
        changes: metadata.changes ?? {},
      }
    }),
  }
}

export { monthRange } from './period'

export const isMonthKey = (value: string | null): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

export type BillingRow = {
  municipalityId: number
  name: string
  billingStatus: BillingStatus
  activeUsers: number
  snapshotUsers: number | null
  tier: number
  tierManual: boolean
  licenceYearlyCzk: number | null
  smsPackage: string | null
  smsQuota: number | null
  smsPartsMonth: number
  smsOveragePartsMonth: number
  smsPartsPeriod: number
  /** What the month's SMS past the quota are billed at (smsOveragePriceCzk each). */
  smsOverageCzkMonth: number | null
  scrapingPackage: string | null
  scrapingFrequency: string | null
  enabledSources: number
  maxSources: number | null
  /** Sources the obec may have past its package's — billed each a year. */
  extraSources: number | null
  /** The whole scraping a year: package + extra sources + twice-weekly reading. */
  scrapingYearlyCzk: number | null
  /** Sources set up this month — each a one-off sourceSetupFeeCzk. */
  sourcesSetUpMonth: number
  sourceSetupCzkMonth: number | null
  runsMonth: number
  inputTokensMonth: number
  outputTokensMonth: number
  /** What the import AI cost the platform this month — internal, never billed. */
  aiCostUsdMonth: number
  yearlyTotalCzk: number | null
}

/**
 * Sources whose set-up fee falls in [from, to), per obec: web addresses the obec set up for the first
 * time then — from the audit log (event-sources.create, append-only), so a source deleted and added
 * again, or switched off and on, is never billed twice; nor is one set up and taken down within the
 * month spared (the work was done).
 */
export async function sourcesSetUpIn(payload: Payload, from: Date, to: Date): Promise<Map<number, number>> {
  const { rows } = await payload.db.drizzle.execute<{ municipality_id: number; sources: string }>(sql`
    WITH firsts AS (
      SELECT municipality_id, lower(rtrim(metadata->>'url', '/')) AS url, MIN(created_at) AS first_at
      FROM audit_log
      WHERE action = 'event-sources.create'
        AND municipality_id IS NOT NULL
        AND metadata->>'url' IS NOT NULL
      GROUP BY municipality_id, lower(rtrim(metadata->>'url', '/'))
    )
    SELECT municipality_id, COUNT(*) AS sources
    FROM firsts
    WHERE first_at >= ${from.toISOString()} AND first_at < ${to.toISOString()}
    GROUP BY municipality_id
  `)
  return new Map(rows.map((r) => [Number(r.municipality_id), Number(r.sources)]))
}

/** Every obec for one month — the overview in the superadmin panel and its CSV export. */
export async function billingRowsFor(
  payload: Payload,
  month: string,
  now: Date,
): Promise<BillingRow[]> {
  const { from, to } = monthRange(month)
  const [municipalities, snapshots, runs, setUpBy, aiCost] = await Promise.all([
    payload.find({
      collection: 'municipalities',
      select: { name: true },
      sort: 'name',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'active-user-snapshots',
      where: { month: { equals: month } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'import-runs',
      where: {
        and: [
          { startedAt: { greater_than_equal: from.toISOString() } },
          { startedAt: { less_than: to.toISOString() } },
        ],
      },
      select: { municipality: true, inputTokens: true, outputTokens: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    sourcesSetUpIn(payload, from, to),
    importAiCostUsd(payload, from, to),
  ])
  const snapshotBy = new Map(
    snapshots.docs.map((s) => [relationNumber(s.municipality), s.activeUsers]),
  )
  const runsBy = new Map<number, { runs: number; input: number; output: number }>()
  for (const r of runs.docs) {
    const id = relationNumber(r.municipality)
    if (id === null) continue
    const t = runsBy.get(id) ?? { runs: 0, input: 0, output: 0 }
    t.runs++
    t.input += r.inputTokens ?? 0
    t.output += r.outputTokens ?? 0
    runsBy.set(id, t)
  }

  const rows: BillingRow[] = []
  for (const m of municipalities.docs) {
    const [services, smsMonth] = await Promise.all([
      getMunicipalityServices(payload, m.id, now),
      countSmsParts(payload, m.id, from, to),
    ])
    const r = runsBy.get(m.id) ?? { runs: 0, input: 0, output: 0 }
    const scraping = services.scraping
    const sourcesSetUp = setUpBy.get(m.id) ?? 0
    rows.push({
      municipalityId: m.id,
      name: m.name,
      billingStatus: services.billingStatus,
      activeUsers: services.licence.activeUsers,
      snapshotUsers: snapshotBy.get(m.id) ?? null,
      tier: services.licence.tier,
      tierManual: services.licence.tierManual,
      licenceYearlyCzk: services.licence.yearlyPriceCzk,
      smsPackage: services.sms.enabled ? PACKAGE_LABELS[services.sms.package] : null,
      smsQuota: services.sms.enabled ? services.sms.quota : null,
      smsPartsMonth: smsMonth.parts,
      smsOveragePartsMonth: smsMonth.overageParts,
      smsPartsPeriod: services.sms.usedParts,
      smsOverageCzkMonth:
        services.sms.overagePriceCzk != null ? round2(smsMonth.overageParts * services.sms.overagePriceCzk) : null,
      scrapingPackage: scraping.enabled ? PACKAGE_LABELS[scraping.package] : null,
      scrapingFrequency: scraping.enabled ? (scraping.frequency === 'twice_weekly' ? '2× týdně' : '1× týdně') : null,
      enabledSources: scraping.enabledSources,
      maxSources: scraping.enabled ? scraping.maxSources : null,
      extraSources: scraping.enabled ? scraping.extraSources : null,
      scrapingYearlyCzk: scraping.enabled ? scraping.yearlyPriceCzk : null,
      sourcesSetUpMonth: sourcesSetUp,
      sourceSetupCzkMonth: scraping.setupFeeCzk != null ? sourcesSetUp * scraping.setupFeeCzk : null,
      runsMonth: r.runs,
      inputTokensMonth: r.input,
      outputTokensMonth: r.output,
      aiCostUsdMonth: round2(aiCost.get(m.id) ?? 0),
      yearlyTotalCzk: services.yearlyTotalCzk,
    })
  }
  return rows
}

const CSV_COLUMNS: [keyof BillingRow, string][] = [
  ['name', 'Obec'],
  ['billingStatus', 'Stav'],
  ['snapshotUsers', 'Uživatelé (snímek měsíce)'],
  ['activeUsers', 'Uživatelé (teď)'],
  ['tier', 'Pásmo'],
  ['tierManual', 'Pásmo ručně'],
  ['licenceYearlyCzk', 'Licence Kč/rok'],
  ['smsPackage', 'SMS balíček'],
  ['smsQuota', 'SMS kvóta/rok'],
  ['smsPartsMonth', 'SMS části (měsíc)'],
  ['smsOveragePartsMonth', 'SMS přečerpání (měsíc)'],
  ['smsPartsPeriod', 'SMS části (licenční rok)'],
  ['smsOverageCzkMonth', 'SMS přečerpání Kč (měsíc)'],
  ['scrapingPackage', 'Scraping balíček'],
  ['scrapingFrequency', 'Scraping frekvence'],
  ['enabledSources', 'Zapnuté zdroje'],
  ['maxSources', 'Max. zdrojů'],
  ['extraSources', 'Zdroje navíc'],
  ['scrapingYearlyCzk', 'Scraping Kč/rok'],
  ['sourcesSetUpMonth', 'Zřízené zdroje (měsíc)'],
  ['sourceSetupCzkMonth', 'Zřízení zdrojů Kč (měsíc)'],
  ['runsMonth', 'Běhy scrapingu (měsíc)'],
  ['inputTokensMonth', 'Vstupní tokeny (měsíc)'],
  ['outputTokensMonth', 'Výstupní tokeny (měsíc)'],
  ['aiCostUsdMonth', 'Náklad AI USD (měsíc, interní)'],
  ['yearlyTotalCzk', 'Celkem Kč/rok'],
]

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'ano' : 'ne'
  // A leading = + - @ (or a tab / carriage return before one) would run as a formula in Excel — an
  // obec's name is typed by people. Numbers are written as numbers, so a negative one stays one.
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Semicolon-separated with a BOM — what Czech Excel opens straight away. */
export function billingCsv(rows: BillingRow[]): string {
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(';')
  const lines = rows.map((row) => CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(';'))
  return `﻿${[header, ...lines].join('\r\n')}\r\n`
}
