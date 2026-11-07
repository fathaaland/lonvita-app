import type { Payload } from 'payload'

import { pragueWallTimeToIso } from '@/lib/import/time'
import { relationNumber } from '@/lib/relations'
import {
  getMunicipalityServices,
  type MunicipalityServices,
} from '@/lib/services/municipality-services'

import { listActiveUserSnapshots, type ActiveUserSnapshot } from './active-users'
import { PACKAGE_LABELS } from './catalog'
import { countSmsParts } from './sms'

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
  billingStatus: 'active' | 'suspended'
  billingNote: string | null
  licencePeriodStart: string | null
  licencePeriodEnd: string | null
  licenceTier: number | null
  licenceCustomYearlyCzk: number | null
  implementationFeeCzk: number | null
  smsEnabled: boolean
  smsPackage: string
  smsQuotaOverride: number | null
  smsOverageAllowed: boolean
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
    settings: {
      name: m.name,
      billingStatus: m.billingStatus === 'suspended' ? 'suspended' : 'active',
      billingNote: m.billingNote ?? null,
      licencePeriodStart: m.licencePeriodStart ?? null,
      licencePeriodEnd: m.licencePeriodEnd ?? null,
      licenceTier: m.licenceTier ?? null,
      licenceCustomYearlyCzk: m.licenceCustomYearlyCzk ?? null,
      implementationFeeCzk: m.implementationFeeCzk ?? null,
      smsEnabled: m.smsEnabled === true,
      smsPackage: m.smsPackage ?? 's',
      smsQuotaOverride: m.smsQuotaOverride ?? null,
      smsOverageAllowed: m.smsOverageAllowed === true,
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

/** [start, end) of a "2026-11" month in Prague. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, mo] = month.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  return {
    from: new Date(pragueWallTimeToIso(`${month}-01`, null)),
    to: new Date(pragueWallTimeToIso(`${next}-01`, null)),
  }
}

export const isMonthKey = (value: string | null): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

export type BillingRow = {
  municipalityId: number
  name: string
  billingStatus: 'active' | 'suspended'
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
  scrapingPackage: string | null
  enabledSources: number
  maxSources: number | null
  runsMonth: number
  inputTokensMonth: number
  outputTokensMonth: number
  yearlyTotalCzk: number | null
}

/** Every obec for one month — the overview in the superadmin panel and its CSV export. */
export async function billingRowsFor(
  payload: Payload,
  month: string,
  now: Date,
): Promise<BillingRow[]> {
  const { from, to } = monthRange(month)
  const [municipalities, snapshots, runs] = await Promise.all([
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
      scrapingPackage: services.scraping.enabled ? PACKAGE_LABELS[services.scraping.package] : null,
      enabledSources: services.scraping.enabledSources,
      maxSources: services.scraping.enabled ? services.scraping.maxSources : null,
      runsMonth: r.runs,
      inputTokensMonth: r.input,
      outputTokensMonth: r.output,
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
  ['scrapingPackage', 'Scraping balíček'],
  ['enabledSources', 'Zapnuté zdroje'],
  ['maxSources', 'Max. zdrojů'],
  ['runsMonth', 'Běhy scrapingu (měsíc)'],
  ['inputTokensMonth', 'Vstupní tokeny (měsíc)'],
  ['outputTokensMonth', 'Výstupní tokeny (měsíc)'],
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
