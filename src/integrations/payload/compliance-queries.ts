import { buildQuery, del, get, patch, post } from './client'

import type { PayloadListResponse } from './client'
import type { AuditRow } from '@/lib/compliance/audit-query'
import type { LegalRequirement } from '@/payload-types'

/**
 * The superadmin's compliance — the audit log, the register of law and the retention periods.
 * Platform admins only; every endpoint checks it again.
 */

export type { AuditRow, LegalRequirement }

export type AuditFilterInput = {
  action?: string
  actor?: string
  municipality?: string
  target?: string
  outcome?: '' | 'success' | 'failure'
  from?: string
  to?: string
}

const auditParams = (filters: AuditFilterInput, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...filters, ...extra })) if (value) params.set(key, value)
  return params.toString()
}

export async function getAuditLog(
  filters: AuditFilterInput,
  page: number,
): Promise<{ rows: AuditRow[]; totalDocs: number; totalPages: number; page: number }> {
  return get(`/superadmin/audit-log?${auditParams(filters, { page: String(page) })}`)
}

export const auditCsvUrl = (filters: AuditFilterInput) =>
  `/api/superadmin/audit-log?${auditParams(filters, { format: 'csv' })}`

export async function listLegalRequirements(): Promise<LegalRequirement[]> {
  const result = await get<PayloadListResponse<LegalRequirement>>(
    `/legal-requirements?${buildQuery({ sort: 'code', limit: 200, depth: 1 })}`,
  )
  return result.docs
}

export type LegalRequirementInput = Pick<
  LegalRequirement,
  | 'code'
  | 'title'
  | 'kind'
  | 'url'
  | 'requirement'
  | 'implementation'
  | 'status'
  | 'reviewIntervalMonths'
  | 'esbirkaWatch'
  | 'notes'
> & { owner?: number | null }

export async function createLegalRequirement(data: LegalRequirementInput): Promise<void> {
  await post('/legal-requirements', data)
}

export async function updateLegalRequirement(
  id: number,
  data: Partial<LegalRequirementInput>,
): Promise<void> {
  await patch(`/legal-requirements/${id}`, data)
}

/** "Zkontrolováno" — today; the next review moves a whole interval on (LegalRequirements). */
export async function markLegalRequirementReviewed(id: number, status: 'ok' | 'gap' = 'ok'): Promise<void> {
  await patch(`/legal-requirements/${id}`, { lastReviewedAt: new Date().toISOString(), status })
}

export async function deleteLegalRequirement(id: number): Promise<void> {
  await del(`/legal-requirements/${id}`)
}

export async function runComplianceCheck(): Promise<void> {
  await post('/superadmin/compliance/check')
}

export async function getStoredRetention(): Promise<Record<string, unknown>> {
  return get('/globals/retention-settings?depth=0')
}

export async function saveRetention(values: Record<string, number | null>): Promise<void> {
  await post('/globals/retention-settings', values)
}
