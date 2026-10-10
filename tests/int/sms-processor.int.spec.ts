// @vitest-environment node
import { UnrecoverableError } from 'bullmq'
import { describe, it, afterEach, expect, vi } from 'vitest'

import { processSmsJob } from '../../worker/src/processors/sms.processor'

const job = { to: '+420735929442', message: 'Lonvita: akce „Posezení“ byla zrušena.', requestId: 'event-cancelled-1-7' }

const twilioAnswers = (status: number, body: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const configure = (env: Record<string, string>) => {
  for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_FROM', 'TWILIO_TRIAL_TEMPLATE']) {
    vi.stubEnv(name, env[name] ?? '')
  }
}

describe('SMS go out through Twilio', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('posts the message to the Messages API, from the configured sender', async () => {
    configure({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: 'Lonvita' })
    const fetchMock = twilioAnswers(201, { sid: 'SM1', status: 'queued' })

    await processSmsJob(job, { jobId: 'sms-event-cancelled-1-7' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`)
    const form = init.body as URLSearchParams
    expect(form.get('To')).toBe('+420735929442')
    expect(form.get('Body')).toBe(job.message)
    expect(form.get('From')).toBe('Lonvita')
    expect(form.has('MessagingServiceSid')).toBe(false)
  })

  it('prefers a Messaging Service over a plain sender', async () => {
    configure({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_MESSAGING_SERVICE_SID: 'MG1', TWILIO_FROM: 'Lonvita' })
    const fetchMock = twilioAnswers(201, { sid: 'SM2', status: 'accepted' })

    await processSmsJob(job)

    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams
    expect(form.get('MessagingServiceSid')).toBe('MG1')
    expect(form.has('From')).toBe(false)
  })

  it('sends the predefined template instead of our text on a trial account', async () => {
    configure({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: '+15005550006', TWILIO_TRIAL_TEMPLATE: 'sms_event_notifications' })
    const fetchMock = twilioAnswers(201, { sid: 'SM3', status: 'queued' })

    await processSmsJob(job)

    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams
    expect(form.get('Body')).toBe('sms_event_notifications')
  })

  it("doesn't retry what Twilio will reject again — nor a missing configuration", async () => {
    configure({})
    await expect(processSmsJob(job)).rejects.toBeInstanceOf(UnrecoverableError)

    configure({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: 'Lonvita' })
    twilioAnswers(400, { code: 21211, message: "The 'To' number is not a valid phone number." })
    await expect(processSmsJob(job)).rejects.toBeInstanceOf(UnrecoverableError)
  })

  it('retries when Twilio is busy or down', async () => {
    configure({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: 'Lonvita' })
    for (const status of [429, 503]) {
      twilioAnswers(status, { message: 'Try again later' })
      const error = await processSmsJob(job).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(UnrecoverableError)
    }
  })
})
