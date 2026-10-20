import { buildQuery, buildWhereParams, del, get, patch, post, PayloadApiError } from './client'
import type { PayloadListResponse } from './client'
import type { ImportWarning } from '@/lib/import/contracts'
import { relationId } from '@/lib/relations'

/** Importing events from obce's websites, files and pasted programs (docs/import-akci-z-webu.md). */

export type ImportSourceRow = {
  id: string
  url: string
  label: string
  enabled: boolean
  format: string | null
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
  last_found_count: number | null
}

type PayloadSource = {
  id: number
  url: string
  label?: string | null
  enabled?: boolean | null
  format?: string | null
  lastRunAt?: string | null
  lastSuccessAt?: string | null
  lastError?: string | null
  lastFoundCount?: number | null
}

const mapSource = (s: PayloadSource): ImportSourceRow => ({
  id: String(s.id),
  url: s.url,
  label: s.label || new URL(s.url).hostname,
  enabled: s.enabled !== false,
  format: s.format ?? null,
  last_run_at: s.lastRunAt ?? null,
  last_success_at: s.lastSuccessAt ?? null,
  last_error: s.lastError ?? null,
  last_found_count: s.lastFoundCount ?? null,
})

export async function listImportSources(municipalityId: string): Promise<ImportSourceRow[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId } })
  const result = await get<PayloadListResponse<PayloadSource>>(
    `/event-sources?${where}&${buildQuery({ depth: 0, limit: 50, sort: 'createdAt' })}`,
  )
  return result.docs.map(mapSource)
}

export async function addImportSource(
  municipalityId: string,
  url: string,
  label?: string,
): Promise<ImportSourceRow> {
  const doc = await post<PayloadSource>('/event-sources', {
    municipality: Number(municipalityId),
    url,
    label: label?.trim() || undefined,
  })
  return mapSource(doc)
}

export async function setImportSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  await patch(`/event-sources/${sourceId}`, { enabled })
}

export async function deleteImportSource(sourceId: string): Promise<void> {
  await del(`/event-sources/${sourceId}`)
}

export async function runImportSource(sourceId: string): Promise<void> {
  await post(`/import/sources/${sourceId}/run`)
}

export async function importFromText(municipalityId: string, text: string): Promise<void> {
  await post('/import/text', { municipalityId: Number(municipalityId), text })
}

export async function importFromFile(municipalityId: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('municipalityId', municipalityId)
  form.append('file', file)
  const res = await fetch('/api/import/file', {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new PayloadApiError(body?.error ?? `Request failed with status ${res.status}`, res.status)
  }
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
    municipality: { equals: municipalityId },
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
