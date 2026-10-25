import { NextResponse } from 'next/server'
import { APIError, getPayload } from 'payload'

import config from '@payload-config'
import { approveCandidate } from '@/lib/import/approve'
import { logger, serializeError } from '@/lib/logger'

const MAX_PER_REQUEST = 50

/**
 * "Převzít všechny připravené" — each candidate as the import found it, one after another, each in
 * its own transaction: one that can't go in (taken meanwhile, a rule it breaks) doesn't hold up the rest.
 *
 * POST /api/import/candidates/approve  { ids: number[] }
 * → { results: { id, eventId?, error? }[] }
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : []
  if (ids.length === 0)
    return NextResponse.json({ error: 'Vyberte akce k převzetí.' }, { status: 400 })
  if (ids.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `Najednou jde převzít nejvýš ${MAX_PER_REQUEST} akcí.` },
      { status: 400 },
    )
  }

  const results: { id: number; eventId?: number; error?: string }[] = []
  for (const id of ids) {
    try {
      const { eventId } = await approveCandidate(payload, user, id, undefined, request)
      results.push({ id, eventId })
    } catch (error) {
      const readable =
        (error instanceof APIError && error.status < 500) ||
        (error instanceof Error && error.name === 'ValidationError')
      if (!readable) {
        logger.error('Bulk import approval failed', {
          event: 'import.bulk_approve_failed',
          candidateId: id,
          ...serializeError(error),
        })
      }
      // What broke inside (a database error) goes to the log, not to the browser.
      results.push({
        id,
        error: readable ? (error as Error).message : 'Akci se nepodařilo převzít.',
      })
    }
  }
  return NextResponse.json({ results })
}
