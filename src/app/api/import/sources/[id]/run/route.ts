import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { aiImportRateLimited, mayImportFor } from '@/lib/import/routes'
import { enqueueImportEvents } from '@/lib/queue/queues'
import { relationId } from '@/lib/relations'

/**
 * Reads an event source now instead of at the next scheduled pass — "Projít teď" next to it.
 * For the obec's admin, or a platform admin.
 *
 * POST /api/import/sources/:id/run → { queued: true }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const source = await payload
    .findByID({ collection: 'event-sources', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!source) return NextResponse.json({ error: 'Zdroj neexistuje.' }, { status: 404 })
  if (!(await mayImportFor(payload, user, relationId(source.municipality)!))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!source.enabled) return NextResponse.json({ error: 'Zdroj je vypnutý.' }, { status: 409 })

  const limited = await aiImportRateLimited(user.id)
  if (limited) return limited

  // A click twice in a row is one read.
  await enqueueImportEvents(
    { kind: 'source', sourceId: source.id },
    { deduplication: { id: `import-source-run-${source.id}`, ttl: 60_000 } },
  )
  return NextResponse.json({ queued: true })
}
