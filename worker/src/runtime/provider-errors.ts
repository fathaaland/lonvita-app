/**
 * The provider (Resend, BulkGate) said "too many requests". Not the job's fault and not one of its
 * tries: the queue's worker pauses the whole queue for `retryAfterMs` and puts the job back
 * (spawn-worker), instead of burning its attempts while the provider is still saying no.
 */
export class ProviderRateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 1_000,
  ) {
    super(message)
    this.name = 'ProviderRateLimitedError'
  }
}

/** Rejects after `ms` — for provider calls that take no AbortSignal of their own. A timed-out send
 * is retried; the provider's idempotency key (or duplicate check) keeps it from going out twice. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
