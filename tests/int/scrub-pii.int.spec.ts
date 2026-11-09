import { describe, expect, it } from 'vitest'

import { opsAlertFor } from '@/lib/alerts/ops'
import { scrubPii, scrubSentryEvent, scrubSpan } from '@/lib/scrub-pii'

// What leaves for Sentry and the ops channels carries no personal data — the stored logs redact by
// key, but an error's message and a URL can't be redacted that way.

describe('scrubPii', () => {
  it("drops a failed query's values, keeps the SQL and the stack", () => {
    const text =
      'Failed query: insert into "profiles" ("full_name", "phone") values ($1, $2)\nparams: Jana Nováková,+420 777 123 456\n    at NodePgPreparedQuery (session.ts:1:1)'
    const out = scrubPii(text)
    expect(out).toContain('insert into "profiles"')
    expect(out).toContain('params: [redacted]')
    expect(out).toContain('at NodePgPreparedQuery')
    expect(out).not.toContain('Nováková')
    expect(out).not.toContain('777')
  })

  it('masks e-mail addresses and phone numbers, not ids or dates', () => {
    const out = scrubPii(
      'Resend rejected jana.novakova@obec.cz, sms to 777123456 for event 1234 on 2026-11-09',
    )
    expect(out).toBe('Resend rejected [email], sms to [phone] for event 1234 on 2026-11-09')
  })

  it('masks one-time tokens in URLs', () => {
    expect(scrubPii('https://lonvita.cz/reset-password?token=abc123&x=1')).toBe(
      'https://lonvita.cz/reset-password?token=[redacted]&x=1',
    )
  })
})

describe('scrubSentryEvent', () => {
  it('cleans the exception, the request and the breadcrumbs, and drops the request body', () => {
    const event = scrubSentryEvent({
      exception: { values: [{ value: 'Failed query: select 1\nparams: a@b.cz' }] },
      request: {
        url: 'https://lonvita.cz/api/auth/reset-password?token=secret',
        data: { password: 'x' },
      },
      breadcrumbs: [{ message: 'mail to a@b.cz', data: { url: '/api/x?code=123' } }],
    })
    expect(event.exception!.values![0].value).toBe('Failed query: select 1\nparams: [redacted]')
    expect(event.request!.url).toBe('https://lonvita.cz/api/auth/reset-password?token=[redacted]')
    expect(event.request!.data).toBe('[redacted]')
    expect(event.breadcrumbs![0].message).toBe('mail to [email]')
    expect(event.breadcrumbs![0].data!.url).toBe('/api/x?code=[redacted]')
  })
})

describe('ops alerts', () => {
  it("carry no address from an error's message", () => {
    const alert = opsAlertFor({
      level: 'error',
      message: 'Account deletion failed for a@b.cz',
      event: 'users.anonymize_failed',
      service: 'web',
      environment: 'production',
      fields: { errorMessage: 'duplicate key\nparams: a@b.cz,777123456' },
    })
    const text = JSON.stringify(alert)
    expect(text).not.toContain('a@b.cz')
    expect(text).not.toContain('777123456')
  })
})

describe('scrubSpan', () => {
  it('cleans the span name and its string attributes', () => {
    const span = scrubSpan({
      name: 'GET /reset-password?token=abc',
      attributes: {
        'url.full': 'https://x/?token=abc',
        'user.email': { type: 'string', value: 'a@b.cz' },
        n: 3,
      },
    })
    expect(span.name).toBe('GET /reset-password?token=[redacted]')
    expect(span.attributes['url.full']).toBe('https://x/?token=[redacted]')
    expect((span.attributes['user.email'] as { value: string }).value).toBe('[email]')
    expect(span.attributes.n).toBe(3)
  })
})
