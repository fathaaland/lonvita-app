import { buildQuery, buildWhereParams, del, get, patch, post, PayloadApiError } from './client'
import type { PayloadListResponse } from './client'
import { IMPORT_LIMITS, type ImportWarning, type SyncNotice } from '@/lib/import/contracts'
import { relationId } from '@/lib/relations'

/** Importing events from obce's websites, files and pasted programs (docs/import-akci-z-webu.md).
 * Everything belongs to an obec (collections/access/import). */

type WhereClause = Parameters<typeof buildWhereParams>[0]

/** The obec's records. */
const ownerWhere = (municipalityId: string): WhereClause => ({
  municipality: { equals: municipalityId },
})

export type ImportSourceRow = {
  id: string
  url: string
  label: string
  enabled: boolean
  format: string | null
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
  /** What kind of failure (ImportFetchError code…) — 'robots_disallowed' offers the waiver. */
  last_error_code: string | null
  last_found_count: number | null
  /** Failed reads in a row — the source switches itself off at IMPORT_LIMITS.failuresBeforePause. */
  consecutive_failures: number
  /** Read past the web's robots.txt — the obec runs it (EventSources.ignoreRobots). */
  ignore_robots: boolean
  ignore_robots_at: string | null
  /** A read asked for and not started yet (EventSources.queuedAt). */
  queued_at: string | null
  /** The worker is reading it now (EventSources.runningSince). */
  running_since: string | null
}

export type PayloadSource = {
  id: number
  url: string
  label?: string | null
  enabled?: boolean | null
  format?: string | null
  lastRunAt?: string | null
  lastSuccessAt?: string | null
  lastError?: string | null
  lastErrorCode?: string | null
  lastFoundCount?: number | null
  consecutiveFailures?: number | null
  ignoreRobots?: boolean | null
  ignoreRobotsAt?: string | null
  queuedAt?: string | null
  runningSince?: string | null
}

export const mapSource = (s: PayloadSource): ImportSourceRow => ({
  id: String(s.id),
  url: s.url,
  label: s.label || new URL(s.url).hostname,
  enabled: s.enabled !== false,
  format: s.format ?? null,
  last_run_at: s.lastRunAt ?? null,
  last_success_at: s.lastSuccessAt ?? null,
  last_error: s.lastError ?? null,
  last_error_code: s.lastErrorCode ?? null,
  last_found_count: s.lastFoundCount ?? null,
  consecutive_failures: s.consecutiveFailures ?? 0,
  ignore_robots: Boolean(s.ignoreRobots),
  ignore_robots_at: s.ignoreRobotsAt ?? null,
  queued_at: s.queuedAt ?? null,
  running_since: s.runningSince ?? null,
})

const isFresh = (iso: string | null, now: number) =>
  Boolean(iso) && now - new Date(iso!).getTime() < IMPORT_LIMITS.runStaleMinutes * 60_000

/** What the source is up to: being read, waiting for the worker, or neither. A state older than
 * IMPORT_LIMITS.runStaleMinutes is a worker that died midway — it's shown as finished. */
export function sourceActivity(
  source: ImportSourceRow,
  now = Date.now(),
): 'running' | 'queued' | null {
  if (!source.enabled) return null
  if (isFresh(source.running_since, now)) return 'running'
  const queuedAfterLastRun =
    source.queued_at &&
    (!source.last_run_at || new Date(source.queued_at) > new Date(source.last_run_at))
  return queuedAfterLastRun && isFresh(source.queued_at, now) ? 'queued' : null
}

export async function listImportSources(municipalityId: string): Promise<ImportSourceRow[]> {
  const where = buildWhereParams(ownerWhere(municipalityId))
  const result = await get<PayloadListResponse<PayloadSource>>(
    `/event-sources?${where}&${buildQuery({ depth: 0, limit: 50, sort: 'createdAt' })}`,
  )
  return result.docs.map(mapSource)
}

export async function addImportSource(
  municipalityId: string,
  url: string,
  { label }: { label?: string } = {},
): Promise<ImportSourceRow> {
  const doc = await post<PayloadSource>('/event-sources', {
    municipality: Number(municipalityId),
    url,
    label: label?.trim() || undefined,
    // The form asks first: the web is theirs, or its operator lets them take events from it.
    ownerConsent: true,
  })
  return mapSource(doc)
}

export async function setImportSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  await patch(`/event-sources/${sourceId}`, { enabled })
}

/** The obec runs the web: read it past its robots.txt (and right away), or stop doing so. */
export async function setImportSourceIgnoreRobots(
  sourceId: string,
  ignoreRobots: boolean,
): Promise<void> {
  await patch(`/event-sources/${sourceId}`, { ignoreRobots })
}

export async function deleteImportSource(sourceId: string): Promise<void> {
  await del(`/event-sources/${sourceId}`)
}

export async function runImportSource(sourceId: string): Promise<void> {
  await post(`/import/sources/${sourceId}/run`)
}

/** A pasted program on its way — `jobId` finds how it went (getImportRunByJob). */
export async function importFromText(
  municipalityId: string,
  text: string,
): Promise<{ jobId: string | null }> {
  const result = await post<{ jobId?: string | null }>('/import/text', {
    municipalityId: Number(municipalityId),
    text,
  })
  return { jobId: result?.jobId ?? null }
}

export async function importFromFile(
  municipalityId: string,
  file: File,
): Promise<{ jobId: string | null }> {
  const form = new FormData()
  form.append('municipalityId', municipalityId)
  form.append('file', file)
  const res = await fetch('/api/import/file', {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new PayloadApiError(body?.error ?? `Request failed with status ${res.status}`, res.status)
  }
  return { jobId: body?.jobId ?? null }
}

/** One read of a source or a manual import (ImportRuns). */
export type ImportRunRow = {
  id: string
  status: 'running' | 'success' | 'unchanged' | 'failed' | 'skipped'
  error: string | null
  found: number | null
  created: number | null
  started_at: string
}

type PayloadRun = {
  id: number
  status: ImportRunRow['status']
  error?: string | null
  found?: number | null
  created?: number | null
  startedAt: string
}

const mapRun = (r: PayloadRun): ImportRunRow => ({
  id: String(r.id),
  status: r.status,
  error: r.error ?? null,
  found: r.found ?? null,
  created: r.created ?? null,
  started_at: r.startedAt,
})

const latestRun = async (where: WhereClause): Promise<ImportRunRow | null> => {
  const result = await get<PayloadListResponse<PayloadRun>>(
    `/import-runs?${buildWhereParams(where)}&${buildQuery({ depth: 0, limit: 1, sort: '-startedAt' })}`,
  )
  return result.docs[0] ? mapRun(result.docs[0]) : null
}

/** How the manual import queued as `jobId` went — null while it waits for the worker. */
export const getImportRunByJob = (jobId: string) => latestRun({ jobId: { equals: jobId } })

/** The source's last read — what the panel says once it's done. */
export const getLatestSourceRun = (sourceId: string) =>
  latestRun({ source: { equals: sourceId } })

/** Pasted programs and files of the obec being read right now — still shown after a reload. */
export async function listRunningManualImports(municipalityId: string): Promise<ImportRunRow[]> {
  const since = new Date(Date.now() - IMPORT_LIMITS.runStaleMinutes * 60_000).toISOString()
  const result = await get<PayloadListResponse<PayloadRun>>(
    `/import-runs?${buildWhereParams({
      municipality: { equals: municipalityId },
      source: { exists: false },
      status: { equals: 'running' },
      startedAt: { greater_than: since },
    })}&${buildQuery({ depth: 0, limit: 10, sort: '-startedAt' })}`,
  )
  return result.docs.map(mapRun)
}

export type ImportCandidateRow = {
  id: string
  title: string
  description: string | null
  starts_at: string
  time_known: boolean
  ends_at: string | null
  location_text: string | null
  lat: number | null
  lng: number | null
  detail_url: string | null
  category_ids: string[]
  is_paid: boolean
  price_czk: number | null
  warnings: ImportWarning[]
  origin: 'source' | 'text' | 'file'
  origin_label: string | null
  duplicate_of: string | null
  municipality_id: string
}

type PayloadCandidate = {
  id: number
  title: string
  description?: string | null
  startsAt: string
  timeKnown?: boolean | null
  endsAt?: string | null
  locationText?: string | null
  lat?: number | null
  lng?: number | null
  detailUrl?: string | null
  categories?: (number | { id: number })[] | null
  isPaid?: boolean | null
  priceCzk?: number | null
  warnings?: unknown
  origin: ImportCandidateRow['origin']
  originLabel?: string | null
  duplicateOf?: number | { id: number } | null
  municipality: number | { id: number }
}

const mapCandidate = (c: PayloadCandidate): ImportCandidateRow => ({
  id: String(c.id),
  title: c.title,
  description: c.description ?? null,
  starts_at: c.startsAt,
  time_known: c.timeKnown !== false,
  ends_at: c.endsAt ?? null,
  location_text: c.locationText ?? null,
  lat: c.lat ?? null,
  lng: c.lng ?? null,
  detail_url: c.detailUrl ?? null,
  category_ids: (c.categories ?? []).map(relationId).filter((v): v is string => Boolean(v)),
  is_paid: Boolean(c.isPaid),
  price_czk: c.priceCzk ?? null,
  warnings: Array.isArray(c.warnings) ? (c.warnings as ImportWarning[]) : [],
  origin: c.origin,
  origin_label: c.originLabel ?? null,
  duplicate_of: relationId(c.duplicateOf),
  municipality_id: relationId(c.municipality)!,
})

const pendingWhere = (municipalityId: string) =>
  buildWhereParams({
    ...ownerWhere(municipalityId),
    status: { equals: 'pending' },
    startsAt: { greater_than: new Date().toISOString() },
  })

/** The obec's candidates still waiting for a decision whose start is ahead, soonest first. */
export async function listPendingImportCandidates(
  municipalityId: string,
): Promise<ImportCandidateRow[]> {
  const result = await get<PayloadListResponse<PayloadCandidate>>(
    `/event-import-candidates?${pendingWhere(municipalityId)}&${buildQuery({ depth: 0, limit: 300, sort: 'startsAt' })}`,
  )
  return result.docs.map(mapCandidate)
}

export async function countPendingImportCandidates(municipalityId: string): Promise<number> {
  const result = await get<PayloadListResponse<{ id: number }>>(
    `/event-import-candidates?${pendingWhere(municipalityId)}&${buildQuery({ depth: 0, limit: 1 })}`,
  )
  return result.totalDocs
}

export async function getImportCandidate(id: string): Promise<ImportCandidateRow | null> {
  try {
    return mapCandidate(await get<PayloadCandidate>(`/event-import-candidates/${id}?depth=0`))
  } catch (error) {
    if (error instanceof PayloadApiError && error.status === 404) return null
    throw error
  }
}

/** The form's values when the admin edits the event before taking it over. */
export type ImportApprovalEdits = {
  title: string
  description: string
  dateTime: string
  endDateTime: string | null
  locationText: string
  lat: number
  lng: number
  categoryIds: number[]
  capacity: number
  registrationApprovalMode: 'auto' | 'manual'
  accessibilityTags: string[]
  imageId: number | null
  imagePositionX: number
  imagePositionY: number
  isVolunteering: boolean
  isPaid: boolean
  priceCents: number | null
}

export async function approveImportCandidate(
  id: string,
  edits?: ImportApprovalEdits,
): Promise<{ eventId: string }> {
  const result = await post<{ eventId: number }>(`/import/candidates/${id}/approve`, edits ?? {})
  return { eventId: String(result.eventId) }
}

export async function approveImportCandidates(
  ids: string[],
): Promise<{ id: string; eventId?: string; error?: string }[]> {
  const result = await post<{ results: { id: number; eventId?: number; error?: string }[] }>(
    '/import/candidates/approve',
    {
      ids: ids.map(Number),
    },
  )
  return result.results.map((r) => ({
    id: String(r.id),
    eventId: r.eventId ? String(r.eventId) : undefined,
    error: r.error,
  }))
}

export async function rejectImportCandidate(id: string): Promise<void> {
  await post(`/import/candidates/${id}/reject`)
}

/** A taken-over event its source changed in a way the import left to its owner (lib/import/sync). */
export type ImportSyncRow = {
  id: string
  event_id: string | null
  title: string
  starts_at: string
  time_known: boolean
  location_text: string | null
  detail_url: string | null
  origin_label: string | null
  notices: SyncNotice[]
  noticed_at: string | null
}

type PayloadSyncCandidate = {
  id: number
  event?: number | { id: number } | null
  title: string
  startsAt: string
  timeKnown?: boolean | null
  locationText?: string | null
  detailUrl?: string | null
  originLabel?: string | null
  syncNotices?: unknown
  noticedAt?: string | null
}

export async function listSyncNotices(municipalityId: string): Promise<ImportSyncRow[]> {
  const where = buildWhereParams({
    ...ownerWhere(municipalityId),
    status: { equals: 'approved' },
    syncNeedsReview: { equals: true },
  })
  const result = await get<PayloadListResponse<PayloadSyncCandidate>>(
    `/event-import-candidates?${where}&${buildQuery({ depth: 0, limit: 100, sort: '-noticedAt' })}`,
  )
  return result.docs.map((c) => ({
    id: String(c.id),
    event_id: relationId(c.event),
    title: c.title,
    starts_at: c.startsAt,
    time_known: c.timeKnown !== false,
    location_text: c.locationText ?? null,
    detail_url: c.detailUrl ?? null,
    origin_label: c.originLabel ?? null,
    notices: Array.isArray(c.syncNotices) ? (c.syncNotices as SyncNotice[]) : [],
    noticed_at: c.noticedAt ?? null,
  }))
}

/** "Převzít z webu" or "Beru na vědomí". */
export async function decideSyncNotices(id: string, action: 'apply' | 'dismiss'): Promise<void> {
  await post(`/import/candidates/${id}/sync`, { action })
}

// --- The platform's admins (superadmin panel) ------------------------------------------------

export type ImportOverviewMunicipality = {
  id: string
  name: string
  /** Its own monthly AI limit (USD) — null: the default. */
  budget_usd: number | null
  spent_usd: number
  pending_candidates: number
  sources: ImportSourceRow[]
}

export type ImportOverview = {
  ai_enabled: boolean
  default_budget_usd: number
  municipalities: ImportOverviewMunicipality[]
}

export async function getImportOverview(): Promise<ImportOverview> {
  const result = await get<{
    aiEnabled: boolean
    defaultBudgetUsd: number
    municipalities: {
      id: number
      name: string
      budgetUsd: number | null
      spentUsd: number
      pendingCandidates: number
      sources: PayloadSource[]
    }[]
  }>('/admin/import-overview')
  return {
    ai_enabled: result.aiEnabled,
    default_budget_usd: result.defaultBudgetUsd,
    municipalities: result.municipalities.map((m) => ({
      id: String(m.id),
      name: m.name,
      budget_usd: m.budgetUsd,
      spent_usd: m.spentUsd,
      pending_candidates: m.pendingCandidates,
      sources: m.sources.map(mapSource),
    })),
  }
}

/** Every AI read on the platform on or off (ImportSettings). */
export async function setImportAiEnabled(aiEnabled: boolean): Promise<void> {
  await post('/globals/import-settings', { aiEnabled })
}

/** The obec's own monthly AI limit — null back to the default. */
export async function setMunicipalityAiBudget(
  municipalityId: string,
  budgetUsd: number | null,
): Promise<void> {
  await patch(`/municipalities/${municipalityId}`, { importAiBudgetUsd: budgetUsd })
}
