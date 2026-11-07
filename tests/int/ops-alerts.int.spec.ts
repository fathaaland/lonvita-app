import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsAlertFor, raiseOpsAlertFor, sendOpsAlert } from '@/lib/alerts/ops'

const line = (event: string | null, fields: Record<string, unknown> = {}, message = 'm') => ({
  level: 'error',
  message,
  event,
  service: 'worker',
  environment: 'test',
  fields: { event, ...fields },
})

describe('ops alerts — what pages the platform team', () => {
  it('a fatal line, a crash and a job lost for good raise an alert; a job still retrying does not', () => {
    expect(opsAlertFor(line('payload.unhandled_error', { severity: 'fatal' }, '[FATAL] boom'))).toMatchObject({
      severity: 'critical',
      title: 'FATAL: boom',
    })
    expect(opsAlertFor(line('worker.uncaught_exception'))).toMatchObject({ severity: 'critical' })
    expect(opsAlertFor(line('queue.job_failed', { exhausted: true, jobType: 'send-email' }))).toMatchObject({
      key: 'job-exhausted:send-email',
      severity: 'critical',
    })
    expect(opsAlertFor(line('queue.job_failed', { exhausted: true, jobType: 'import-events' }))).toMatchObject({
      severity: 'warning',
    })
    expect(opsAlertFor(line('queue.job_failed', { exhausted: false, jobType: 'send-email' }))).toBeNull()
  })

  it('failed logins and rate limits count towards a burst; ordinary lines raise nothing', () => {
    expect(opsAlertFor(line('auth.login_failed'))).toEqual({ burst: 'auth.login_failed' })
    expect(opsAlertFor(line('security.rate_limit_exceeded'))).toEqual({ burst: 'security.rate_limit_exceeded' })
    expect(opsAlertFor(line('queue.job_completed'))).toBeNull()
    expect(opsAlertFor(line(null))).toBeNull()
  })

  it('carries no personal data out — only the listed facts', () => {
    const alert = opsAlertFor(
      line('users.anonymize_failed', { userEmail: 'someone@example.com', errorMessage: 'db down', correlationId: 'c1' }),
    )
    expect(alert && 'details' in alert ? JSON.stringify(alert.details) : '').not.toContain('someone@example.com')
  })

  describe('delivery', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    it('posts once to Discord per incident within the throttle window, mentions disabled', async () => {
      vi.stubEnv('OPS_DISCORD_WEBHOOK_URL', 'https://discord.test/webhook')
      vi.stubEnv('OPS_ALERT_EMAILS', '')
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      const alert = { key: `test-${Date.now()}-${Math.random()}`, severity: 'critical' as const, title: 'x', details: {} }
      expect(await sendOpsAlert(alert)).toBe(true)
      expect(await sendOpsAlert(alert)).toBe(false)

      const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toBe('https://discord.test/webhook')
      expect(JSON.parse(String(calls[0][1].body))).toMatchObject({ allowed_mentions: { parse: [] } })
    })

    it('stays silent when no channel is configured', async () => {
      vi.stubEnv('OPS_DISCORD_WEBHOOK_URL', '')
      vi.stubEnv('OPS_ALERT_EMAILS', '')
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await raiseOpsAlertFor(line('worker.uncaught_exception'))
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
