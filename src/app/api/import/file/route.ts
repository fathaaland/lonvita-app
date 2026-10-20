import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { IMPORT_LIMITS, isImportFileType } from '@/lib/import/contracts'
import { aiImportRateLimited, mayImportFor } from '@/lib/import/routes'
import { importFileKey, uploadImportFile } from '@/lib/import/storage'
import { logger, serializeError } from '@/lib/logger'
import { enqueueImportEvents } from '@/lib/queue/queues'

/** The magic bytes of what IMPORT_FILE_TYPES allows — the browser's declared type isn't proof. */
function sniffType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  return null
}

/**
 * A program as a file — a PDF of the zpravodaj, a photo of a poster. Stored for the worker (S3, until
 * it's read), which reads it with the AI; the admin is notified once its events wait in the Import tab.
 *
 * POST /api/import/file  multipart { municipalityId, file } → { queued: true }
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const municipalityId = String(form?.get('municipalityId') ?? '')
  const file = form?.get('file')
  if (!(file instanceof File))
    return NextResponse.json({ error: 'Vyberte soubor.' }, { status: 400 })
  if (!(await mayImportFor(payload, user, municipalityId)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (file.size > IMPORT_LIMITS.fileMaxBytes) {
    return NextResponse.json(
      { error: 'Soubor je větší než 4 MB — zmenšete ho nebo nahrajte jen stránky s programem.' },
      { status: 400 },
    )
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const mimeType = sniffType(bytes)
  if (!isImportFileType(mimeType)) {
    return NextResponse.json(
      { error: 'Nahrát jde PDF nebo obrázek (JPG, PNG, WebP).' },
      { status: 400 },
    )
  }

  const limited = await aiImportRateLimited(user.id)
  if (limited) return limited

  const fileName = (file.name || 'soubor').slice(0, 120)
  const fileKey = importFileKey(fileName)
  try {
    await uploadImportFile(fileKey, bytes, mimeType)
  } catch (error) {
    logger.error('Import file upload failed', {
      event: 'import.file_upload_failed',
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Soubor se nepodařilo nahrát.' }, { status: 500 })
  }
  await enqueueImportEvents({
    kind: 'file',
    municipalityId: Number(municipalityId),
    requestedBy: user.id,
    fileKey,
    fileName,
    mimeType,
  })
  return NextResponse.json({ queued: true })
}
