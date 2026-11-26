import { EMAIL_QUEUE_NAME, HEAVY_QUEUE_NAME, QUEUE_NAME, SMS_QUEUE_NAME } from '@/lib/queue/contracts'

/**
 * Which queues this process consumes — WORKER_QUEUES, a comma-separated list of `main`, `email`,
 * `sms` and `heavy` (unset or `all`: every one). Lets the imports and export rendering (`heavy`, which
 * hold the event loop for minutes) run in a service of their own, so they can't hold up e-mails or
 * the clock, and so that service can get a long drain on a deploy. Whatever the split, every queue
 * has to be consumed by some service — /api/health reports a queue whose heartbeat is missing.
 */
export const WORKER_QUEUE_KEYS = ['main', 'email', 'sms', 'heavy'] as const
export type WorkerQueueKey = (typeof WORKER_QUEUE_KEYS)[number]

export const QUEUE_NAME_OF: Record<WorkerQueueKey, string> = {
  main: QUEUE_NAME,
  email: EMAIL_QUEUE_NAME,
  sms: SMS_QUEUE_NAME,
  heavy: HEAVY_QUEUE_NAME,
}

/** Throws on an unknown name — a typo must stop the boot, not leave a queue nobody reads. */
export function parseWorkerQueues(value: string | undefined): WorkerQueueKey[] {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === '' || raw === 'all') return [...WORKER_QUEUE_KEYS]
  const names = [...new Set(raw.split(',').map((name) => name.trim()).filter(Boolean))]
  const unknown = names.filter((name) => !(WORKER_QUEUE_KEYS as readonly string[]).includes(name))
  if (unknown.length > 0 || names.length === 0) {
    throw new Error(
      `WORKER_QUEUES has unknown queue(s): ${unknown.join(', ') || '(none given)'} — use ${WORKER_QUEUE_KEYS.join(', ')} or all`,
    )
  }
  return WORKER_QUEUE_KEYS.filter((key) => names.includes(key))
}
