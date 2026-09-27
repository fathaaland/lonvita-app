import { buildEventsCsv, filterEvents, filterRegistrations, periodStart } from '@/lib/analytics'
import { computeOrganizationStats } from '@/lib/organization-stats'
import { buildNarrative, buildReportRows, computeReportMetrics } from '@/lib/report'

import { EXPORT_CONTENT_TYPES, fileSlug } from './contracts'
import { loadMunicipalityExportData, loadOrganizationExportData } from './load'
import { renderCommunityReportDocx, renderCommunityReportPdf } from './render/community-report'
import { renderOrganizationReportPdf } from './render/organization-report'

import type { ExportRequest } from './contracts'
import type { Payload } from 'payload'

export type BuiltExport = {
  body: Buffer
  fileName: string
  contentType: string
}

/** Excel only reads a CSV as UTF-8 (diacritics intact) when it starts with a BOM. */
const csvBuffer = (csv: string): Buffer => Buffer.from(`﻿${csv}`, 'utf-8')

/**
 * Loads, computes and renders one export — the whole of the worker's `generate-export` job short
 * of the bookkeeping. `ownerId` is who asked: "Jen moje akce" means events they organize.
 */
export async function buildExport(payload: Payload, request: ExportRequest, ownerId: string): Promise<BuiltExport> {
  const contentType = EXPORT_CONTENT_TYPES[request.format]

  switch (request.kind) {
    case 'community-report': {
      const { municipalityId, scope } = request.params
      const data = await loadMunicipalityExportData(payload, municipalityId, scope === 'mine' ? ownerId : undefined)
      const metrics = computeReportMetrics(data.events, data.registrations, data.profiles)
      const input = {
        metrics,
        rows: buildReportRows(metrics),
        narrative: buildNarrative(metrics, data.municipalityName),
        municipalityName: data.municipalityName,
      }
      const base = `report-${fileSlug(data.municipalityName)}-${fileSlug(metrics.periodLabel)}`
      return request.format === 'docx'
        ? { body: await renderCommunityReportDocx(input), fileName: `${base}.docx`, contentType }
        : { body: renderCommunityReportPdf(input), fileName: `${base}.pdf`, contentType }
    }

    case 'municipality-events': {
      const { municipalityId, scope, period } = request.params
      const data = await loadMunicipalityExportData(payload, municipalityId, scope === 'mine' ? ownerId : undefined)
      const start = periodStart(period)
      const csv = buildEventsCsv(
        filterEvents(data.events, start),
        filterRegistrations(data.registrations, start),
        data.categories,
        data.profiles,
      )
      return { body: csvBuffer(csv), fileName: `prehled-${fileSlug(data.municipalityName)}-${period}.csv`, contentType }
    }

    case 'organization-report': {
      const data = await loadOrganizationExportData(payload, request.params.organizationId)
      const base = `organizace-${fileSlug(data.organizationName)}`
      if (request.format === 'csv') {
        return { body: csvBuffer(buildEventsCsv(data.events, data.registrations, data.categories, [])), fileName: `${base}.csv`, contentType }
      }
      const body = renderOrganizationReportPdf({
        organizationName: data.organizationName,
        stats: computeOrganizationStats(data.events, data.registrations, data.coOrganizedIds),
        feedback: data.feedback,
        events: data.events,
        registrations: data.registrations,
        categories: data.categories,
      })
      return { body, fileName: `${base}.pdf`, contentType }
    }
  }
}
