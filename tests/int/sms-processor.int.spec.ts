// @vitest-environment node
import { UnrecoverableError } from 'bullmq'
import { describe, it, afterEach, expect, vi } from 'vitest'

import { smsPartsOf, toSmsText } from '@/lib/billing/sms'

import { processSmsJob } from '../../worker/src/processors/sms.processor'

vi.mock('../../worker/src/runtime/payload', () => ({ getWorkerPayload: async () => ({}) }))
// The ledger itself is tested against the database (billing-enforcement); here, what the worker does with its answer.
const { claim, confirm, drop } = vi.hoisted(() => ({
  claim: vi.fn(async (): Promise<{ decision: 'send'; rowId: number; overage: boolean } | { decision: 'skip'; reason: string }> => ({
    decision: 'send',
    rowId: 7,
    overage: false,
  })),
  confirm: vi.fn(async () => undefined),
  drop: vi.fn(async () => undefined),
}))
vi.mock('@/lib/billing/sms-ledger', () => ({ claimSmsParts: claim, confirmSmsClaim: confirm, dropSmsClaim: drop }))
const { release } = vi.hoisted(() => ({ release: vi.fn(async () => undefined) }))
vi.mock('@/lib/billing/sms-reservations', () => ({ releaseSmsReservation: release }))
const { checkAlerts } = vi.hoisted(() => ({ checkAlerts: vi.fn(async () => undefined) }))
vi.mock('@/lib/billing/sms-alerts', () => ({ checkSmsUsageAlerts: checkAlerts }))
const { sentMarkers } = vi.hoisted(() => ({ sentMarkers: new Set<string>() }))
vi.mock('@/lib/billing/sms-sent-marker', () => ({
  wasSmsSent: async (id?: string) => (id ? sentMarkers.has(id) : false),
  markSmsSent: async (id?: string) => {
    if (id) sentMarkers.add(id)
  },
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
    claim.mockClear()
    confirm.mockClear()
    drop.mockClear()
    release.mockClear()
    checkAlerts.mockClear()
    sentMarkers.clear()
  })

  it('does not text again when an earlier attempt of the same request already went out', async () => {
    configure(credentials)
    const fetchMock = bulkGateAnswers(200, accepted('tmp1'))

    await processSmsJob({ ...job, municipalityId: 42 })
    // The job never finished (crash, lost acknowledgement) and is retried hours later.
    await processSmsJob({ ...job, municipalityId: 42 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('sends Czech text without diacritics and counts the parts it goes out as', () => {
    expect(toSmsText('Lonvita: akce „Žluťoučký kůň“ – čtvrtek…')).toBe('Lonvita: akce "Zlutoucky kun" - ctvrtek...')
    expect(smsPartsOf('a'.repeat(160))).toBe(1)
    expect(smsPartsOf('a'.repeat(161))).toBe(2)
    expect(smsPartsOf('a'.repeat(306))).toBe(2)
    expect(smsPartsOf('a'.repeat(307))).toBe(3)
  })

  it("puts a sent SMS on its obec's ledger before sending — and a job without an obec on nobody's", async () => {
    configure(credentials)
    const fetchMock = bulkGateAnswers(200, accepted('tmp9'))

    await processSmsJob({ ...job, municipalityId: 42 })
    expect(claim).toHaveBeenCalledWith(expect.anything(), { municipalityId: 42, requestId: job.requestId, parts: 1, purpose: 'announcement' })
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
    expect(confirm).toHaveBeenCalledWith(expect.anything(), 7, 'tmp9')
    expect(release).toHaveBeenCalledWith(42, job.requestId, 1)
    expect(checkAlerts).toHaveBeenCalledWith(expect.anything(), 42, expect.any(Date))
    expect(drop).not.toHaveBeenCalled()

    claim.mockClear()
    await processSmsJob(job)
    expect(claim).not.toHaveBeenCalled()
  })

  it('does not text when the obec has no SMS left — and gives its reservation back', async () => {
    configure(credentials)
    const fetchMock = bulkGateAnswers(200, accepted('tmp3'))
    claim.mockResolvedValueOnce({ decision: 'skip', reason: 'quota_used_up' })

    await processSmsJob({ ...job, municipalityId: 42 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith(42, job.requestId, 1)
    // The admins hear the quota ran out, even though the SMS was queued within it.
    expect(checkAlerts).toHaveBeenCalledWith(expect.anything(), 42, expect.any(Date))
  })

  it('a reminder asks the ledger as a reminder', async () => {
    configure(credentials)
    const fetchMock = bulkGateAnswers(200, accepted('tmp5'))
    claim.mockResolvedValueOnce({ decision: 'skip', reason: 'quota_used_up' })

    await processSmsJob({ ...job, municipalityId: 42, purpose: 'reminder' })
    expect(claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: 'reminder' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith(42, job.requestId, 1)
  })

  it('gives the reservation back once the SMS fails for good — not while a retry may still send it', async () => {
    configure(credentials)
    bulkGateAnswers(503, { error: 'Try again later' })
    await expect(processSmsJob({ ...job, municipalityId: 42 }, { attemptsMade: 3, attempts: 10 })).rejects.toThrow()
    expect(release).not.toHaveBeenCalled()

    bulkGateAnswers(503, { error: 'Try again later' })
    await expect(processSmsJob({ ...job, municipalityId: 42 }, { attemptsMade: 9, attempts: 10 })).rejects.toThrow()
    expect(release).toHaveBeenCalledWith(42, job.requestId, 1)

    release.mockClear()
    bulkGateAnswers(400, { type: 'invalid_phone_number', error: 'Invalid phone number' })
    await expect(processSmsJob({ ...job, municipalityId: 42 }, { attemptsMade: 0, attempts: 10 })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(release).toHaveBeenCalledWith(42, job.requestId, 1)

    // An overage SMS held nothing.
    release.mockClear()
    bulkGateAnswers(400, { type: 'invalid_phone_number', error: 'Invalid phone number' })
    await expect(processSmsJob({ ...job, municipalityId: 42, overage: true })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(release).not.toHaveBeenCalled()
  })

  it('takes the row back off the ledger when BulkGate refuses or cannot be reached', async () => {
    configure(credentials)
    bulkGateAnswers(400, { type: 'invalid_phone_number', error: 'Invalid phone number' })
    await expect(processSmsJob({ ...job, municipalityId: 42 })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(drop).toHaveBeenCalledWith(expect.anything(), 7, job.requestId)

    drop.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    await expect(processSmsJob({ ...job, municipalityId: 42 })).rejects.toThrow('timeout')
    expect(drop).toHaveBeenCalledTimes(1)
  })

  it('does not send at all when the ledger cannot be checked — the job is retried', async () => {
    configure(credentials)
    const fetchMock = bulkGateAnswers(200, accepted('tmp4'))
    claim.mockRejectedValueOnce(new Error('database down'))
    const error = await processSmsJob({ ...job, municipalityId: 42 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(fetchMock).not.toHaveBeenCalled()
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
      text: 'Lonvita: akce "Posezeni" byla zrusena.',
      unicode: false,
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
