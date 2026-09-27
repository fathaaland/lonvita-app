import { formatDecimal, formatPercent } from '@/lib/organization-stats'

import { createPdf, PDF_FONT, pdfToBuffer } from './pdf'

import type { CategoryRow, EventRow, RegistrationRow } from '@/lib/analytics'
import type { OrganizationFeedbackSummary, OrganizationStats } from '@/lib/organization-stats'

/** The "Organizace" page's numbers plus a table of its events (organizace/page.tsx). */
export type OrganizationReportInput = {
  organizationName: string
  stats: OrganizationStats
  feedback: OrganizationFeedbackSummary | null
  events: EventRow[]
  registrations: RegistrationRow[]
  categories: CategoryRow[]
  generatedAt?: Date
}

export function renderOrganizationReportPdf({
  organizationName,
  stats,
  feedback,
  events,
  registrations,
  categories,
  generatedAt = new Date(),
}: OrganizationReportInput): Buffer {
  const cats = new Map(categories.map((c) => [c.id, c.name]))
  const approved = registrations.filter((r) => r.status === 'approved')
  const pdf = createPdf()
  const marginX = 48
  let y = 56

  const ensureSpace = (needed: number) => {
    if (y + needed > pdf.internal.pageSize.getHeight() - 48) {
      pdf.addPage()
      y = 56
    }
  }

  pdf.setFont(PDF_FONT, 'bold').setFontSize(18)
  pdf.text(`Statistiky organizace — ${organizationName}`, marginX, y)
  y += 22
  pdf.setFont(PDF_FONT, 'italic').setFontSize(10).setTextColor(102)
  pdf.text(`Vygenerováno ${generatedAt.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}`, marginX, y)
  pdf.setTextColor(0)
  y += 26

  pdf.setFont(PDF_FONT, 'bold').setFontSize(14)
  pdf.text('Klíčová čísla', marginX, y)
  y += 20
  pdf.setFont(PDF_FONT, 'normal').setFontSize(10)
  ;[
    `Počet akcí: ${stats.eventCount} (spolupořádané: ${stats.coOrganizedCount})`,
    `Lidí na akcích: ${stats.people} (opakovaně: ${stats.returning})`,
    `Průměrná naplněnost: ${stats.fillRate === null ? '—' : formatPercent(stats.fillRate)}`,
    `Spokojenost: ${feedback?.avg_satisfaction == null ? '—' : `${formatDecimal(feedback.avg_satisfaction)} / 5 (${feedback.count} hodnocení)`}`,
  ].forEach((line) => {
    ensureSpace(16)
    pdf.text(line, marginX, y)
    y += 16
  })
  y += 10

  ensureSpace(20)
  pdf.setFont(PDF_FONT, 'bold').setFontSize(14)
  pdf.text('Přehled akcí', marginX, y)
  y += 18

  const colWidths = [220, 110, 60, 60, 50]
  const colX = colWidths.map((_, i) => marginX + colWidths.slice(0, i).reduce((a, b) => a + b, 0))
  const drawRow = (cells: string[], bold: boolean) => {
    ensureSpace(16)
    pdf.setFont(PDF_FONT, bold ? 'bold' : 'normal').setFontSize(9)
    cells.forEach((c, i) => pdf.text(c, colX[i], y, { maxWidth: colWidths[i] - 6 }))
    y += 16
  }
  drawRow(['Název', 'Kategorie', 'Kapacita', 'Schváleno', 'Stav'], true)
  events.forEach((e) => {
    drawRow(
      [
        e.title,
        e.category_ids.map((id) => cats.get(id)).filter(Boolean).join(', '),
        String(e.capacity),
        String(approved.filter((r) => r.event_id === e.id).length),
        e.status,
      ],
      false,
    )
  })

  return pdfToBuffer(pdf)
}
