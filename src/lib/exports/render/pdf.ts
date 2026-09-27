import { readFileSync } from 'node:fs'

import { jsPDF } from 'jspdf'

/**
 * jsPDF's built-in Helvetica only covers WinAnsi — "ř", "ě", "ů" came out garbled in the old
 * browser-made PDFs. Noto Sans (SIL OFL) is embedded instead; the files ship in the repo next to
 * this module, so the worker image needs nothing extra.
 */
export const PDF_FONT = 'NotoSans'

const FONT_FILES = {
  normal: 'NotoSans-Regular.ttf',
  bold: 'NotoSans-Bold.ttf',
  italic: 'NotoSans-Italic.ttf',
} as const

let fontData: Record<keyof typeof FONT_FILES, string> | undefined

const loadFonts = () => {
  fontData ??= Object.fromEntries(
    Object.entries(FONT_FILES).map(([style, file]) => [
      style,
      readFileSync(new URL(`../fonts/${file}`, import.meta.url)).toString('base64'),
    ]),
  ) as Record<keyof typeof FONT_FILES, string>
  return fontData
}

/** An A4 document (pt units) with Noto Sans registered and selected. */
export function createPdf(): jsPDF {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const fonts = loadFonts()
  for (const [style, file] of Object.entries(FONT_FILES) as [keyof typeof FONT_FILES, string][]) {
    pdf.addFileToVFS(file, fonts[style])
    pdf.addFont(file, PDF_FONT, style)
  }
  pdf.setFont(PDF_FONT, 'normal')
  return pdf
}

export const pdfToBuffer = (pdf: jsPDF): Buffer => Buffer.from(pdf.output('arraybuffer'))
