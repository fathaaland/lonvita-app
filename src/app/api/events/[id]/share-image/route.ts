import { NextResponse } from 'next/server'

import { eventDisplayLink, isShareImageFormat, shareImageVersion } from '@/lib/eventShare'
import { logger, serializeError } from '@/lib/logger'
import { consumeRateLimit, getClientIp } from '@/lib/security/rate-limit'
import { renderEventShareImage } from '@/lib/share/eventShareImage'
import { loadShareEvent } from '@/lib/share/loadShareEvent'

/**
 * The event's generated share image — the link preview Facebook & co. show (og:image on the event
 * detail), an Instagram post or a story — for the "Sdílet" dialog. Public, like the event itself:
 * Facebook's crawler fetches it signed out.
 *
 * GET /api/events/:id/share-image?format=og|post|story[&v=<shareImageVersion>]
 * → image/jpeg. With the current `v` the response is cached for good (a new edit changes `v`).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(request.url)
  const format = url.searchParams.get('format') ?? 'og'
  if (!isShareImageFormat(format)) {
    return NextResponse.json({ error: 'Neznámý formát obrázku.' }, { status: 400 })
  }

  // Each render resizes a photo and rasterizes a page — cheap enough for people and crawlers, not
  // for a script looping over the ids.
  const rateLimit = await consumeRateLimit({
    namespace: 'event-share-image',
    identifier: getClientIp(request.headers),
    max: 60,
    windowSeconds: 60,
  })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } },
    )
  }

  const event = await loadShareEvent(id)
  if (!event) return NextResponse.json({ error: 'Akce nebyla nalezena.' }, { status: 404 })

  const versioned = url.searchParams.get('v') === shareImageVersion(event.updatedAt)
  try {
    // The app's configured address (production), else the one the image was asked for on.
    const link = eventDisplayLink(process.env.NEXT_PUBLIC_APP_URL || url.origin, event.id)
    const jpeg = await renderEventShareImage(event, format, link)
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': versioned
          ? 'public, max-age=31536000, s-maxage=31536000, immutable'
          : 'public, max-age=300, s-maxage=300',
      },
    })
  } catch (error) {
    logger.error('Event share image failed', { event: 'share-image.failed', eventId: id, format, ...serializeError(error) })
    return NextResponse.json({ error: 'Obrázek se nepodařilo vytvořit.' }, { status: 500 })
  }
}
