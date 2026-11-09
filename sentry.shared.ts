import { scrubBreadcrumb, scrubSentryEvent, scrubSpan } from './src/lib/scrub-pii'

/** Shared between the three Sentry runtimes (browser, Node, edge). The DSN is a public key — it is
 * inlined into the client bundle on purpose. Without it Sentry stays off (tests, forks). */
export const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN

/** Vercel exposes its environment (production / preview / development); elsewhere fall back to
 * NODE_ENV so local events never land in "production". */
export const sentryEnvironment =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV

export const sentryTracesSampleRate = process.env.NODE_ENV === 'development' ? 1.0 : 0.1

/** Every runtime's events and breadcrumbs pass through lib/scrub-pii on the way out: a failed query's
 * values, e-mail addresses, phone numbers and URL tokens stay here. */
export const sentryScrubbing = {
  beforeSend: scrubSentryEvent,
  beforeSendSpan: scrubSpan,
  beforeBreadcrumb: scrubBreadcrumb,
}
