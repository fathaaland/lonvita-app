import { z } from 'zod'

/**
 * What can be exported, and in which formats — shared by the POST /api/exports route (validation),
 * the worker (rendering) and the client (`useExport`). The files used to be built in the browser
 * from the whole obec's events/registrations/profiles; they're now rendered by the worker straight
 * from the database, so a slow machine or a big obec no longer freezes the admin page.
 */

export const EXPORT_STATUSES = ['queued', 'processing', 'done', 'failed'] as const
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

export const EXPORT_FORMATS = ['docx', 'pdf', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const EXPORT_KINDS = ['community-report', 'organization-report', 'municipality-events'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

const recordId = z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d+$/))

/** "Celá obec" vs "Jen moje akce" on the admin dashboard — "mine" means organized by the requester. */
const scope = z.enum(['all', 'mine']).default('all')

export const exportRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('community-report'),
    format: z.enum(['docx', 'pdf']),
    params: z.object({ municipalityId: recordId, scope }),
  }),
  z.object({
    kind: z.literal('organization-report'),
    format: z.enum(['pdf', 'csv']),
    params: z.object({ organizationId: recordId }),
  }),
  z.object({
    kind: z.literal('municipality-events'),
    format: z.literal('csv'),
    params: z.object({ municipalityId: recordId, scope, period: z.enum(['7', '30', '90', 'all']) }),
  }),
])

export type ExportRequest = z.infer<typeof exportRequestSchema>
export type ExportRequestInput = z.input<typeof exportRequestSchema>

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
}

/** How the export is named in the "report je připraven" notification. */
export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  'community-report': 'Přehled komunitního života',
  'organization-report': 'Statistiky organizace',
  'municipality-events': 'Přehled akcí obce',
}

/** A generated file is kept this long — then the nightly cleanup drops it from S3 and the DB. */
export const EXPORT_RETENTION_DAYS = 7

/** What GET /api/exports/:id answers — the client polls it until `status` settles. */
export type ExportStatusResponse = {
  id: number
  status: ExportStatus
  fileName: string | null
  error: string | null
}

/** Readable, filesystem-safe base for the downloaded file's name ("report-Nové-Město-Q3-2026"). */
export const fileSlug = (text: string): string => text.trim().replace(/[\s/\\:*?"<>|]+/g, '-')
