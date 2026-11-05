import { getPayload } from 'payload'
import config from '@payload-config'

import { subscribeToCapacity } from '@/lib/realtime/eventCapacity'
import { logger } from '@/lib/logger'
import { consumeRateLimit, getClientIp } from '@/lib/security/rate-limit'
import { PARTICIPANTS_ONLY } from '@/collections/Registrations'

/** Every open stream holds a serverless invocation and a count query on connect, so an unmetered
 * public endpoint would let one client tie up both. EventSource reconnects by itself, which is what
 * a page legitimately adds up to: a few tabs, each reconnecting after a dropped network or a
 * platform timeout. */
const STREAM_RATE_LIMIT = { max: 30, windowSeconds: 60 }

/**
 * Brief §8 "websocket bude sledovat aktivitu na backendu zdali se někdo neodhlásí, pokud ano,
 * automaticky to tlačítko bude fungovat" — live capacity updates for the event-detail page's
 * "Přihlásit se" / "Akce je plná" button. Server-Sent Events instead of a raw WebSocket: it's
 * a plain streamed HTTP response (works on Vercel and anywhere else without a separate
 * long-lived server), the browser's EventSource reconnects on its own, and this is one-way
 * (server → client) traffic anyway — nothing here needs the client to push back.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  // The id becomes a Redis channel name and a query filter — only a real row id may.
  if (!/^\d{1,12}$/.test(id)) {
    return new Response('Not found', { status: 404 })
  }

  const rateLimit = await consumeRateLimit({
    namespace: 'capacity-stream',
    identifier: getClientIp(request.headers),
    ...STREAM_RATE_LIMIT,
  })
  if (!rateLimit.allowed) {
    // EventSource retries a failed connection on its own; Retry-After says when that helps.
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(rateLimit.retryAfter) },
    })
  }

  const payload = await getPayload({ config })

  const encoder = new TextEncoder()
  let closed = false
  let stopListening: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  // Idempotent, and reachable from both the abort signal and the stream's cancel() — whichever
  // comes first must stop the heartbeat and leave the shared subscriber, or both outlive the client.
  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    stopListening?.()
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          cleanup()
        }
      }

      // Listening first, so a change landing between the count and the subscription isn't missed.
      stopListening = subscribeToCapacity(id, send)

      // Current count immediately on connect, so the client doesn't need a separate fetch
      // before it knows where things stand.
      try {
        const result = await payload.count({
          collection: 'registrations',
          where: { and: [{ event: { equals: id } }, { status: { equals: 'approved' } }, PARTICIPANTS_ONLY] },
          overrideAccess: true,
        })
        send({ approvedCount: result.totalDocs })
      } catch (error) {
        logger.error('Capacity stream initial count failed', {
          event: 'realtime.capacity_stream_count_failed',
          err: String(error),
          eventId: id,
        })
      }

      // Most platforms (and browsers) will otherwise time out an idle streamed connection.
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup()
        }
      }, 25000)

      request.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      })
      if (request.signal.aborted) cleanup()
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
