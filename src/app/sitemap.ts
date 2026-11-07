import { getPayload } from 'payload'

import config from '@payload-config'
import { eventPath } from '@/lib/eventShare'

import type { MetadataRoute } from 'next'

/** Regenerated at most once an hour — not on every crawler's request. */
export const revalidate = 3600

/** Events a search engine is worth pointing at — the ones still ahead, and the last weeks'. */
const PAST_EVENTS_KEPT_MS = 30 * 24 * 60 * 60 * 1000
const MAX_EVENTS = 5_000

/**
 * The public pages and every published event a signed-out visitor can open (Events' own read
 * access, as for an anonymous request). Drafts and cancelled events aren't in it.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) return []
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
  ]
  try {
    const payload = await getPayload({ config })
    const events = await payload.find({
      collection: 'events',
      where: {
        and: [
          { status: { not_equals: 'cancelled' } },
          { dateTime: { greater_than: new Date(Date.now() - PAST_EVENTS_KEPT_MS).toISOString() } },
        ],
      },
      select: { updatedAt: true },
      sort: '-dateTime',
      limit: MAX_EVENTS,
      depth: 0,
      overrideAccess: false,
    })
    return [
      ...pages,
      ...events.docs.map((event) => ({
        url: `${base}${eventPath(event.id)}`,
        lastModified: event.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ]
  } catch {
    // The database away at build or request time — the pages alone rather than no sitemap.
    return pages
  }
}
