/**
 * Personal data out of text that leaves for a third party — Sentry (all three runtimes and the worker)
 * and the platform team's Discord/e-mail alerts (lib/alerts/ops). The stored logs redact by key
 * (lib/logger); an error's own message and a URL can't be redacted that way, so they get this:
 * - a failed Drizzle query's `params:` — the values the row was about to hold (e-mails, names, phones);
 * - e-mail addresses and Czech phone numbers anywhere in the text;
 * - one-time tokens in URLs (password reset, export download, OAuth `code`/`state`).
 * No imports: loaded by the browser bundle, the edge runtime and the worker alike.
 */

const PARAMS = /\nparams: [\s\S]*?(?=\n\s+at |$)/g
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// +420 123 456 789, 123456789, 123 456 789 — whole numbers only, so ids and timestamps stay.
const PHONE = /(?<![\w+])(?:\+?420 ?)?\d{3} ?\d{3} ?\d{3}(?![\w])/g
const URL_SECRET =
  /([?&#](?:token|code|state|password|secret|key|signature|X-Amz-Signature|X-Amz-Credential)=)[^&#\s"']*/gi

export const scrubPii = (text: string): string =>
  text
    .replace(PARAMS, '\nparams: [redacted]')
    .replace(URL_SECRET, '$1[redacted]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')

const scrubMaybe = <T>(value: T): T => (typeof value === 'string' ? (scrubPii(value) as T) : value)

/** The parts of a Sentry event that carry free text. Structural typing — no @sentry import, so the
 * same function serves @sentry/nextjs and @sentry/node. */
type ScrubbableEvent = {
  message?: string
  exception?: { values?: { value?: string }[] }
  request?: { url?: string; query_string?: unknown; data?: unknown }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  logentry?: { message?: string; formatted?: string }
}

export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  event.message = scrubMaybe(event.message)
  for (const value of event.exception?.values ?? []) value.value = scrubMaybe(value.value)
  if (event.logentry) {
    event.logentry.message = scrubMaybe(event.logentry.message)
    event.logentry.formatted = scrubMaybe(event.logentry.formatted)
  }
  if (event.request) {
    event.request.url = scrubMaybe(event.request.url)
    if (typeof event.request.query_string === 'string')
      event.request.query_string = scrubPii(event.request.query_string)
    else if (event.request.query_string) event.request.query_string = '[redacted]'
    // A request body is whatever the citizen typed — never needed to find a bug.
    if (event.request.data !== undefined) event.request.data = '[redacted]'
  }
  for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumb(crumb)
  return event
}

export function scrubBreadcrumb<B extends { message?: string; data?: Record<string, unknown> }>(
  crumb: B,
): B {
  crumb.message = scrubMaybe(crumb.message)
  if (crumb.data) {
    for (const key of ['url', 'to', 'from']) {
      if (typeof crumb.data[key] === 'string') crumb.data[key] = scrubPii(crumb.data[key] as string)
    }
  }
  return crumb
}
