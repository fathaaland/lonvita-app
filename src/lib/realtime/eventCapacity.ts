import { Redis } from 'ioredis'

import { queueConnectionOptions } from '@/lib/valkey/client'
import { logger } from '@/lib/logger'

/**
 * Brief §8 "jednoduchý if zablokuje možnost se přihlásit na FE, websocket bude sledovat
 * aktivitu na backendu zdali se někdo neodhlásí, pokud ano, automaticky to tlačítko bude
 * fungovat" — decided as SSE over Valkey pub/sub (Vercel doesn't host long-lived raw
 * WebSocket servers well; SSE is a plain HTTP response and needs no separate infra).
 *
 * One Redis channel per event: `event-capacity:<eventId>`. Publishing is cheap and reuses a
 * single shared connection (ioredis allows normal commands, including PUBLISH, on one
 * connection). Subscribing puts a connection into a dedicated mode that can no longer run
 * other commands, so each SSE connection gets its own client — see capacity-stream/route.ts.
 */

const channelFor = (eventId: string | number) => `event-capacity:${eventId}`

let publisher: Redis | undefined

const getPublisher = (): Redis => {
  if (!publisher) {
    publisher = new Redis({ ...queueConnectionOptions, lazyConnect: false })
    publisher.on('error', (err) =>
      logger.error('Realtime publisher Redis connection error', {
        event: 'realtime.publisher_connection_error',
        err: String(err),
      }),
    )
  }
  return publisher
}

/** Fire-and-forget — a failed publish must never block the registration write that triggered
 * it. Clients simply won't get a live update this time; the next page load is still correct. */
export function publishCapacityChange(eventId: string | number, approvedCount: number): void {
  getPublisher()
    .publish(channelFor(eventId), JSON.stringify({ approvedCount }))
    .catch((err) =>
      logger.error('Failed to publish capacity change', {
        event: 'realtime.capacity_publish_failed',
        err: String(err),
        eventId,
      }),
    )
}

export function createCapacitySubscriber(): Redis {
  return new Redis({ ...queueConnectionOptions, lazyConnect: false })
}

export function capacityChannel(eventId: string | number): string {
  return channelFor(eventId)
}
