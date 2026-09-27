import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

import { datavitaParagraph, methodologyParagraph, reportTitle } from '@/lib/report'

import { createPdf, PDF_FONT, pdfToBuffer } from './pdf'

import type { Narrative, ReportMetrics, ReportRow } from '@/lib/report'

/** The municipality report (US-A-10, CommunityReport.tsx) — layered so a journalist takes the
 * first paragraph, a grant application the whole thing, the council the first four sections. */
export type CommunityReportInput = {
  metrics: ReportMetrics
  rows: ReportRow[]
  narrative: Narrative
  municipalityName: string
  generatedAt?: Date
}

export async function renderCommunityReportDocx({
  metrics,
  rows,
  narrative,
  municipalityName,
  generatedAt,
}: CommunityReportInput): Promise<Buffer> {
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }
  const headerCell = (t: string, w: number) =>
    new TableCell({
      borders,
      width: { size: w, type: WidthType.DXA },
      shading: { fill: 'F0EBE3', type: ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
    })
  const cell = (t: string, w: number) =>
    new TableCell({
      borders,
      width: { size: w, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun(t)] })],
    })

  const widths = [3600, 1920, 1920, 1920]
  const tableRows = [
    new TableRow({
      children: [
        headerCell('Metrika', widths[0]),
        headerCell('Toto období', widths[1]),
        headerCell('Minulé období', widths[2]),
        headerCell('Změna', widths[3]),
      ],
    }),
    ...rows.map(
      (r) =>
        new TableRow({
          children: [
            cell(r.metric, widths[0]),
            cell(r.current, widths[1]),
            cell(r.previous, widths[2]),
            cell(r.change, widths[3]),
          ],
        }),
    ),
  ]

  const heading = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] })
  const paragraph = (text: string) => new Paragraph({ children: [new TextRun(text)] })

  const doc = new Document({
    creator: 'Lonvita',
    title: `Přehled komunitního života — ${municipalityName}`,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Calibri', color: '2F2F2F' },
          paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Calibri', color: '2F2F2F' },
          paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(reportTitle(metrics, municipalityName))] }),
          new Paragraph({
            children: [
              new TextRun({ text: `Období: ${metrics.periodFrom} – ${metrics.periodTo}`, italics: true, color: '666666' }),
            ],
          }),

          heading('Shrnutí'),
          paragraph(narrative.summary),

          heading('Klíčová čísla'),
          new Table({
            width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            columnWidths: widths,
            rows: tableRows,
            alignment: AlignmentType.LEFT,
          }),

          heading('Co se změnilo'),
          paragraph(narrative.whatChanged),

          heading('Datavita'),
          paragraph(datavitaParagraph(metrics)),

          heading('Metodická poznámka'),
          paragraph(methodologyParagraph(metrics, generatedAt)),
        ],
      },
    ],
  })

  return Packer.toBuffer(doc)
}

export function renderCommunityReportPdf({
  metrics,
  rows,
  narrative,
  municipalityName,
  generatedAt,
}: CommunityReportInput): Buffer {
  const pdf = createPdf()
  const marginX = 48
  const pageWidth = pdf.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2
  let y = 56

  const ensureSpace = (needed: number) => {
    if (y + needed > pdf.internal.pageSize.getHeight() - 48) {
      pdf.addPage()
      y = 56
    }
  }
  const heading = (text: string) => {
    ensureSpace(28)
    pdf.setFont(PDF_FONT, 'bold').setFontSize(14)
    pdf.text(text, marginX, y)
    y += 20
  }
  const paragraph = (text: string) => {
    pdf.setFont(PDF_FONT, 'normal').setFontSize(10)
    const lines = pdf.splitTextToSize(text, contentWidth)
    ensureSpace(lines.length * 14 + 10)
    pdf.text(lines, marginX, y)
    y += lines.length * 14 + 10
  }

  pdf.setFont(PDF_FONT, 'bold').setFontSize(18)
  pdf.text(`Přehled komunitního života — ${metrics.periodLabel}`, marginX, y)
  y += 22
  pdf.setFont(PDF_FONT, 'italic').setFontSize(10).setTextColor(102)
  pdf.text(`${municipalityName} · Období: ${metrics.periodFrom} – ${metrics.periodTo}`, marginX, y)
  pdf.setTextColor(0)
  y += 26

  heading('Shrnutí')
  paragraph(narrative.summary)

  heading('Klíčová čísla')
  const colWidths = [contentWidth * 0.4, contentWidth * 0.2, contentWidth * 0.2, contentWidth * 0.2]
  const colX = colWidths.map((_, i) => marginX + colWidths.slice(0, i).reduce((a, b) => a + b, 0))
  const rowHeight = 18
  const drawRow = (cells: string[], bold: boolean) => {
    ensureSpace(rowHeight)
    pdf.setFont(PDF_FONT, bold ? 'bold' : 'normal').setFontSize(9)
    cells.forEach((c, i) => pdf.text(c, colX[i], y))
    y += rowHeight
  }
  drawRow(['Metrika', 'Toto období', 'Minulé období', 'Změna'], true)
  pdf.setDrawColor(204).line(marginX, y - 12, marginX + contentWidth, y - 12)
  rows.forEach((r) => drawRow([r.metric, r.current, r.previous, r.change], false))
  y += 8

  heading('Co se změnilo')
  paragraph(narrative.whatChanged)

  heading('Datavita')
  paragraph(datavitaParagraph(metrics))

  heading('Metodická poznámka')
  paragraph(methodologyParagraph(metrics, generatedAt))

  return pdfToBuffer(pdf)
}
