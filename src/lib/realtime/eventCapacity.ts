import { Redis } from 'ioredis'

import { queueConnectionOptions } from '@/lib/valkey/client'
import { logger } from '@/lib/logger'

/**
 * Brief §8 "jednoduchý if zablokuje možnost se přihlásit na FE, websocket bude sledovat
 * aktivitu na backendu zdali se někdo neodhlásí, pokud ano, automaticky to tlačítko bude
 * fungovat" — decided as SSE over Valkey pub/sub (Vercel doesn't host long-lived raw
 * WebSocket servers well; SSE is a plain HTTP response and needs no separate infra).
 *
 * One Redis channel per event: `event-capacity:<eventId>`. Publishing reuses a single shared
 * connection. Subscribing puts a connection into a mode that can run nothing else — so one
 * subscriber connection per process carries every open stream on it (subscribeToCapacity), not one
 * per viewer: a popular event watched by thousands would otherwise need thousands of Redis
 * connections, on the same server the queue and the rate limiter run on.
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

type CapacityListener = (message: { approvedCount?: number }) => void

let subscriber: Redis | undefined
const listeners = new Map<string, Set<CapacityListener>>()

const getSubscriber = (): Redis => {
  if (!subscriber) {
    subscriber = new Redis({ ...queueConnectionOptions, lazyConnect: false })
    subscriber.on('error', (err) =>
      logger.error('Realtime subscriber Redis connection error', {
        event: 'realtime.subscriber_connection_error',
        err: String(err),
      }),
    )
    subscriber.on('message', (channel: string, raw: string) => {
      const forChannel = listeners.get(channel)
      if (!forChannel) return
      let message: { approvedCount?: number }
      try {
        message = JSON.parse(raw)
      } catch {
        return // malformed — the next one will still come through
      }
      for (const listener of forChannel) {
        try {
          listener(message)
        } catch {
          // one broken stream must not starve the others
        }
      }
    })
  }
  return subscriber
}

/**
 * Listens to one event's capacity changes over this process's single subscriber connection —
 * subscribed in Redis with the first listener, unsubscribed with the last. Returns the unsubscribe.
 */
export function subscribeToCapacity(eventId: string | number, listener: CapacityListener): () => void {
  const channel = channelFor(eventId)
  let forChannel = listeners.get(channel)
  if (!forChannel) {
    forChannel = new Set()
    listeners.set(channel, forChannel)
    getSubscriber()
      .subscribe(channel)
      .catch((error) =>
        logger.error('Capacity stream subscribe failed', {
          event: 'realtime.capacity_stream_subscribe_failed',
          err: String(error),
          eventId,
        }),
      )
  }
  forChannel.add(listener)

  let done = false
  return () => {
    if (done) return
    done = true
    const current = listeners.get(channel)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      listeners.delete(channel)
      subscriber?.unsubscribe(channel).catch(() => {})
    }
  }
}
