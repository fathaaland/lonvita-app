import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { importOwnerFor } from '@/collections/access/import'
import { aiImportNotSubscribed, aiImportRateLimited } from '@/lib/import/routes'
import { enqueueImportEvents } from '@/lib/queue/queues'

const MIN_TEXT_LENGTH = 20

/**
 * A program pasted by the obec's admin or one of its organizers — copied from an e-mail, a Facebook page, anywhere the worker
 * can't go itself. Read by the worker; whoever sent it is notified once its events wait in their Import.
 *
 * POST /api/import/text  { municipalityId, text } → { queued: true, jobId }
 * (`jobId`: its ImportRuns record shows how it went — the panel watches it)
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
  // The obec's admin imports for the obec, an approved organizer for their organization.
  const owner = await importOwnerFor(payload, user, municipalityId)
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const notSubscribed = await aiImportNotSubscribed(payload, municipalityId)
  if (notSubscribed) return notSubscribed

  const limited = await aiImportRateLimited(user.id)
  if (limited) return limited

  const job = await enqueueImportEvents({
    kind: 'text',
    municipalityId: Number(municipalityId),
    requestedBy: user.id,
    organizationId: owner.organization,
    text,
  })
  return NextResponse.json({ queued: true, jobId: job?.id ?? null })
}
