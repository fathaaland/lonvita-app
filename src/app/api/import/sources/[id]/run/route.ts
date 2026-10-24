import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { mayManageImport } from '@/collections/access/import'
import { aiImportRateLimited } from '@/lib/import/routes'
import { enqueueImportEvents } from '@/lib/queue/queues'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/**
 * Reads an event source now instead of at the next scheduled pass — "Projít teď" next to it.
 * For whoever looks after the source (access/import) — the obec's admin or the organizer.
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
  if (!(await mayManageImport(payload, user, source))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!source.enabled) return NextResponse.json({ error: 'Zdroj je vypnutý.' }, { status: 409 })

  const limited = await aiImportRateLimited(user.id)
  if (limited) return limited
  // A full pass may cost an AI read of the page and of its events' own pages — a few a day.
  const perSource = await consumeRateLimit({
    namespace: 'import-source-manual',
    identifier: String(source.id),
    max: IMPORT_LIMITS.manualRunsPerSourcePerDay,
    windowSeconds: 24 * 60 * 60,
  })
  if (!perSource.allowed) {
    return NextResponse.json(
      { error: 'Tenhle zdroj jste dnes kontrolovali už několikrát — zkuste to prosím zítra.' },
      { status: 429, headers: { 'Retry-After': String(perSource.retryAfter) } },
    )
  }

  // A click twice in a row is one read.
  await enqueueImportEvents(
    { kind: 'source', sourceId: source.id, trigger: 'manual', requestedBy: user.id },
    { deduplication: { id: `import-source-run-${source.id}`, ttl: 60_000 } },
  )
  return NextResponse.json({ queued: true })
}
