import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'

import type { Where } from 'payload'

/** The most municipalities one request may ask for — an obec's mikroregion is a handful. */
const MAX_MUNICIPALITIES = 100

// A minute on the CDN, served stale for five more while it refreshes: a new or edited event shows
// up on the listing within about a minute, and a rush of visitors costs one query a minute.
const cacheHeaders = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }

/**
 * The upcoming-events listing of the home page — public and the same for every viewer, so the CDN
 * can answer it: read as a signed-out visitor (no cookies, no user), which sees exactly the published
 * events the listing shows anyway. A signed-in user's extra rights only reach drafts and per-viewer
 * fields (creator flags), neither of which the listing uses. Without this, every visit ran the
 * 200-event query against the database.
 *
 * GET /api/events/upcoming[?municipality=1&municipality=2]
 * No `municipality` = every municipality (the "Všechny obce" view). Ids are sorted client-side so
 * the same mikroregion hits the same cache entry.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams.getAll('municipality')
  const municipalityIds = [...new Set(params.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    .sort((a, b) => a - b)
    .slice(0, MAX_MUNICIPALITIES)

  // Asked for municipalities, none of them valid: an empty listing, not every municipality's.
  if (params.length > 0 && municipalityIds.length === 0) {
    return NextResponse.json({ docs: [] }, { headers: cacheHeaders })
  }

  const where: Where = {
    and: [
      ...(municipalityIds.length > 0 ? [{ municipality: { in: municipalityIds } }] : []),
      { status: { not_equals: 'cancelled' } },
      { isDraft: { not_equals: true } },
      { dateTime: { greater_than: new Date().toISOString() } },
    ],
  }

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'events',
    where,
    sort: 'dateTime',
    depth: 1,
    limit: 200,
    overrideAccess: false,
  })

  return NextResponse.json({ docs: result.docs }, { headers: cacheHeaders })
}
