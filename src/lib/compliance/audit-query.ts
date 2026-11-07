import type { Payload, Where } from 'payload'

import { addDays, pragueWallTimeToIso } from '@/lib/import/time'
import { relationNumber } from '@/lib/relations'

/**
 * The audit log as the superadmin browses it (superadmin → Audit log) — filtered, a page at a time,
 * or whole for the CSV. Every read goes through access control as the superadmin, so it is itself
 * recorded (AuditLog recordRead — vyhláška 409/2025 Sb. § 22 asks for access to the logs to be
 * logged too).
 */

export type AuditFilters = {
  action?: string
  actorEmail?: string
  municipalityId?: number
  outcome?: 'success' | 'failure'
  targetCollection?: string
  from?: string
  to?: string
}

export type AuditRow = {
  id: number
  at: string
  action: string
  outcome: string
  actor: string | null
  actorId: number | null
  municipality: string | null
  targetCollection: string
  targetId: string
  ipAddress: string | null
  userAgent: string | null
  correlationId: string | null
  metadata: unknown
}

const isDay = (value: string | undefined) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const text = (name: string) => params.get(name)?.trim().slice(0, 200) || undefined
  const outcome = params.get('outcome')
  const municipality = Number(params.get('municipality'))
  return {
    action: text('action'),
    actorEmail: text('actor'),
    targetCollection: text('target'),
    municipalityId: Number.isInteger(municipality) && municipality > 0 ? municipality : undefined,
    outcome: outcome === 'success' || outcome === 'failure' ? outcome : undefined,
    from: isDay(text('from')) ? text('from') : undefined,
    to: isDay(text('to')) ? text('to') : undefined,
  }
}

async function whereFor(payload: Payload, f: AuditFilters): Promise<Where | null> {
  const and: Where[] = []
  if (f.action) and.push({ action: { contains: f.action } })
  if (f.targetCollection) and.push({ targetCollection: { equals: f.targetCollection } })
  if (f.outcome) and.push({ outcome: { equals: f.outcome } })
  if (f.municipalityId) and.push({ municipality: { equals: f.municipalityId } })
  // Days in Prague, the end day included.
  if (f.from) and.push({ createdAt: { greater_than_equal: pragueWallTimeToIso(f.from, null) } })
  if (f.to) and.push({ createdAt: { less_than: pragueWallTimeToIso(addDays(f.to, 1), null) } })
  if (f.actorEmail) {
    const users = await payload.find({
      collection: 'users',
      where: { email: { contains: f.actorEmail } },
      select: {},
      depth: 0,
      limit: 100,
      overrideAccess: true,
    })
    if (users.docs.length === 0) return null
    and.push({ actor: { in: users.docs.map((u) => u.id) } })
  }
  return and.length > 0 ? { and } : {}
}

export async function queryAuditLog(
  payload: Payload,
  user: { id: number | string; role?: string | null },
  filters: AuditFilters,
  { page = 1, limit = 50 }: { page?: number; limit?: number } = {},
): Promise<{ rows: AuditRow[]; totalDocs: number; totalPages: number; page: number }> {
  const where = await whereFor(payload, filters)
  if (where === null) return { rows: [], totalDocs: 0, totalPages: 0, page: 1 }
  const result = await payload.find({
    collection: 'audit-log',
    where,
    sort: '-createdAt',
    depth: 0,
    page,
    limit,
    // As the superadmin — the read is recorded (AuditLog recordRead).
    user: user as never,
    overrideAccess: false,
  })

  const actorIds = [
    ...new Set(
      result.docs.map((d) => relationNumber(d.actor)).filter((id): id is number => id !== null),
    ),
  ]
  const municipalityIds = [
    ...new Set(
      result.docs
        .map((d) => relationNumber(d.municipality))
        .filter((id): id is number => id !== null),
    ),
  ]
  const [actors, municipalities] = await Promise.all([
    actorIds.length
      ? payload.find({
          collection: 'users',
          where: { id: { in: actorIds } },
          select: { email: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : null,
    municipalityIds.length
      ? payload.find({
          collection: 'municipalities',
          where: { id: { in: municipalityIds } },
          select: { name: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : null,
  ])
  const emailOf = new Map(actors?.docs.map((u) => [u.id, u.email]) ?? [])
  const nameOf = new Map(municipalities?.docs.map((m) => [m.id, m.name]) ?? [])

  return {
    page: result.page ?? page,
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    rows: result.docs.map((d) => {
      const actorId = relationNumber(d.actor)
      const municipalityId = relationNumber(d.municipality)
      return {
        id: d.id,
        at: d.createdAt,
        action: d.action,
        outcome: d.outcome,
        actor: actorId === null ? null : (emailOf.get(actorId) ?? `#${actorId}`),
        actorId,
        municipality:
          municipalityId === null ? null : (nameOf.get(municipalityId) ?? `#${municipalityId}`),
        targetCollection: d.targetCollection,
        targetId: d.targetId,
        ipAddress: d.ipAddress ?? null,
        userAgent: d.userAgent ?? null,
        correlationId: d.correlationId ?? null,
        metadata: d.metadata ?? null,
      }
    }),
  }
}

const COLUMNS: [keyof AuditRow, string][] = [
  ['at', 'Čas (UTC)'],
  ['action', 'Akce'],
  ['outcome', 'Výsledek'],
  ['actor', 'Kdo'],
  ['municipality', 'Obec'],
  ['targetCollection', 'Cíl'],
  ['targetId', 'ID cíle'],
  ['ipAddress', 'IP adresa'],
  ['userAgent', 'Prohlížeč'],
  ['correlationId', 'ID požadavku'],
  ['metadata', 'Podrobnosti'],
]

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  // A leading = + - @ would run as a formula in Excel.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Semicolon-separated with a BOM — what Czech Excel opens straight away. */
export function auditCsv(rows: AuditRow[]): string {
  const header = COLUMNS.map(([, label]) => cell(label)).join(';')
  const lines = rows.map((row) => COLUMNS.map(([key]) => cell(row[key])).join(';'))
  return `﻿${[header, ...lines].join('\r\n')}\r\n`
}
