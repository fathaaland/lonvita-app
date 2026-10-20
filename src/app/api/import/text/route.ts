import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { aiImportRateLimited, mayImportFor } from '@/lib/import/routes'
import { enqueueImportEvents } from '@/lib/queue/queues'

const MIN_TEXT_LENGTH = 20

/**
 * A program pasted by the obec's admin — copied from an e-mail, a Facebook page, anywhere the worker
 * can't go itself. Read by the worker; the admin is notified once its events wait in the Import tab.
 *
 * POST /api/import/text  { municipalityId, text } → { queued: true }
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    municipalityId?: unknown
    text?: unknown
  } | null
  const municipalityId = String(body?.municipalityId ?? '')
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text.length < MIN_TEXT_LENGTH)
    return NextResponse.json({ error: 'Vložte text programu s akcemi.' }, { status: 400 })
  if (text.length > IMPORT_LIMITS.textMaxChars) {
    return NextResponse.json(
      {
        error: `Text může mít nejvýš ${IMPORT_LIMITS.textMaxChars.toLocaleString('cs-CZ')} znaků.`,
      },
      { status: 400 },
    )
  }
  if (!(await mayImportFor(payload, user, municipalityId)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limited = await aiImportRateLimited(user.id)
  if (limited) return limited

  await enqueueImportEvents({
    kind: 'text',
    municipalityId: Number(municipalityId),
    requestedBy: user.id,
    text,
  })
  return NextResponse.json({ queued: true })
}
