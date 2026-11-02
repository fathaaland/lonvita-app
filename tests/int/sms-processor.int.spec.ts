// @vitest-environment node
import { UnrecoverableError } from 'bullmq'
import { describe, it, afterEach, expect, vi } from 'vitest'

import { processSmsJob } from '../../worker/src/processors/sms.processor'

const createRow = vi.fn(async () => ({}))
vi.mock('../../worker/src/runtime/payload', () => ({
  getWorkerPayload: async () => ({ create: createRow }),
}))

const job = {
  to: '+420735929442',
  message: 'Lonvita: akce „Posezení“ byla zrušena.',
  requestId: 'event-cancelled-1-7',
}

const bulkGateAnswers = (status: number, body: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const accepted = (smsId: string) => ({
  data: { status: 'accepted', sms_id: smsId, number: '420735929442' },
})

const configure = (env: Record<string, string>) => {
  for (const name of [
    'BULKGATE_APPLICATION_ID',
    'BULKGATE_APPLICATION_TOKEN',
    'BULKGATE_SENDER_ID',
    'BULKGATE_SENDER_ID_VALUE',
  ]) {
    vi.stubEnv(name, env[name] ?? '')
  }
}

const credentials = { BULKGATE_APPLICATION_ID: '451', BULKGATE_APPLICATION_TOKEN: 'secret' }

const sentBody = (fetchMock: ReturnType<typeof bulkGateAnswers>) =>
  JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  ) as Record<string, unknown>

describe('SMS go out through BulkGate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    createRow.mockClear()
  })

  it("counts a sent SMS against its obec's monthly SMS — and a job without an obec against nobody", async () => {
    configure(credentials)
    bulkGateAnswers(200, accepted('tmp9'))

    await processSmsJob({ ...job, municipalityId: 42 })
    expect(createRow).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'sms-messages',
        data: { municipality: 42, requestId: job.requestId, providerMessageSid: 'tmp9' },
      }),
    )

    createRow.mockClear()
    await processSmsJob(job)
    expect(createRow).not.toHaveBeenCalled()
  })

  it('posts the message to the Simple API transactional endpoint, from the configured sender', async () => {
    configure({ ...credentials, BULKGATE_SENDER_ID: 'gText', BULKGATE_SENDER_ID_VALUE: 'Lonvita' })
    const fetchMock = bulkGateAnswers(200, accepted('tmp1'))

    await processSmsJob(job, { jobId: 'sms-event-cancelled-1-7' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://portal.bulkgate.com/api/1.0/simple/transactional')
    expect(init.method).toBe('POST')
    expect(sentBody(fetchMock)).toEqual({
      application_id: '451',
      application_token: 'secret',
      number: '420735929442',
      text: job.message,
      unicode: true,
      sender_id: 'gText',
      sender_id_value: 'Lonvita',
      duplicates_check: 'on',
      tag: job.requestId,
    })
  })

  it("falls back to BulkGate's system number without a configured sender", async () => {
    configure(credentials)
    const fetchMock = bulkGateAnswers(200, accepted('tmp2'))

    await processSmsJob(job)

    const body = sentBody(fetchMock)
    expect(body.sender_id).toBe('gSystem')
    expect(body).not.toHaveProperty('sender_id_value')
  })

  it("doesn't retry what BulkGate will reject again — nor a missing configuration", async () => {
    configure({})
    await expect(processSmsJob(job)).rejects.toBeInstanceOf(UnrecoverableError)

    configure(credentials)
    bulkGateAnswers(400, {
      type: 'invalid_phone_number',
      code: 400,
      error: 'Invalid phone number',
      detail: null,
    })
    await expect(processSmsJob(job)).rejects.toBeInstanceOf(UnrecoverableError)

    bulkGateAnswers(401, {
      type: 'unknown_identity',
      code: 401,
      error: 'Unknown identity',
      detail: null,
    })
    await expect(processSmsJob(job)).rejects.toBeInstanceOf(UnrecoverableError)
  })

  it('retries when BulkGate is busy or down', async () => {
    configure(credentials)
    for (const status of [429, 503]) {
      bulkGateAnswers(status, { error: 'Try again later' })
      const error = await processSmsJob(job).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(UnrecoverableError)
    }
  })
})
