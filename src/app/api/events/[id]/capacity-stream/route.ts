import { getPayload } from 'payload'
import config from '@payload-config'

import { createCapacitySubscriber, capacityChannel } from '@/lib/realtime/eventCapacity'
import { logger } from '@/lib/logger'

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
  const payload = await getPayload({ config })

  const encoder = new TextEncoder()
  const subscriber = createCapacitySubscriber()
  const channel = capacityChannel(id)
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller already closed (client disconnected mid-write) — cleanup() below
          // will have run or is about to; nothing more to do here.
        }
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        subscriber.removeAllListeners('message')
        subscriber.unsubscribe(channel).catch(() => {})
        subscriber.quit().catch(() => {})
      }

      // Current count immediately on connect, so the client doesn't need a separate fetch
      // before it knows where things stand.
      try {
        const result = await payload.count({
          collection: 'registrations',
          where: { and: [{ event: { equals: id } }, { status: { equals: 'approved' } }] },
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

      subscriber.on('message', (_channel: string, message: string) => {
        try {
          send(JSON.parse(message))
        } catch {
          // Malformed message — ignore, the next one will still come through.
        }
      })
      subscriber.subscribe(channel).catch((error) => {
        logger.error('Capacity stream subscribe failed', {
          event: 'realtime.capacity_stream_subscribe_failed',
          err: String(error),
          eventId: id,
        })
      })

      // Most platforms (and browsers) will otherwise time out an idle streamed connection.
      const heartbeat = setInterval(() => {
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
    },
    cancel() {
      closed = true
      subscriber.quit().catch(() => {})
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
