// @vitest-environment node
import { getPayload, Payload } from 'payload'
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

// The queue itself is not under test — whether, when and with which job id the outbox hands to it is.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

import { enqueueEmail, enqueueEventCancelled, getEmailQueue } from '@/lib/queue/queues'
import { enqueueOrPark, enqueueThroughOutbox, OUTBOX_RELAY_GRACE_MS } from '@/lib/outbox'
import { JOB_NAMES } from '@/lib/queue/contracts'

import { processOutboxRelayJob } from '../../worker/src/processors/outbox-relay.processor'

import type { OutboxEnvelope } from '@/lib/outbox'

let payload: Payload

const STAMP = Date.now()

const cancelJob = (eventId: number): OutboxEnvelope => ({
  jobType: JOB_NAMES.EVENT_CANCELLED,
  payload: { eventId, title: `Outbox ${STAMP}`, userIds: [], registrationIds: [] },
})

const rowsFor = async (jobId: string) =>
  (
    await payload.find({
      collection: 'outbox',
      where: { jobId: { equals: jobId } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
  ).docs

/** Moves the row's creation back past the relay's grace period — the clock, not a hook. */
const ageRow = (id: number, ms = OUTBOX_RELAY_GRACE_MS + 5_000) =>
  payload.db.updateOne({
    collection: 'outbox',
    id,
    data: { createdAt: new Date(Date.now() - ms).toISOString() },
  })

describe('Transactional outbox (lib/outbox) and its relay', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    // The relay also reads the e-mail queue's length — Redis isn't what's under test here.
    vi.spyOn(getEmailQueue(), 'getWaitingCount').mockResolvedValue(0)
  })

  beforeEach(() => {
    vi.mocked(enqueueEventCancelled).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(enqueueEmail).mockReset().mockResolvedValue(undefined as never)
  })

  afterAll(async () => {
    await payload.db.deleteMany({ collection: 'outbox', where: { jobId: { contains: `-${STAMP}` } } })
  })

  it('hands the job to the queue once the transaction commits, and marks the row dispatched', async () => {
    const jobId = `event-cancelled-commit-${STAMP}`
    const req = await createLocalReq({}, payload)
    await initTransaction(req)
    await enqueueThroughOutbox(req, { job: cancelJob(1), jobId })
    // Inside the transaction: written, but nothing in the queue yet.
    expect(enqueueEventCancelled).not.toHaveBeenCalled()
    await commitTransaction(req)

    expect(enqueueEventCancelled).toHaveBeenCalledTimes(1)
    expect(vi.mocked(enqueueEventCancelled).mock.calls[0][1]).toMatchObject({ jobId })
    const [row] = await rowsFor(jobId)
    expect(row.dispatchedAt).toBeTruthy()
    expect(row.attempts).toBe(1)
  })

  it('leaves nothing behind when the transaction rolls back', async () => {
    const jobId = `event-cancelled-rollback-${STAMP}`
    const req = await createLocalReq({}, payload)
    await initTransaction(req)
    await enqueueThroughOutbox(req, { job: cancelJob(2), jobId })
    await killTransaction(req)

    expect(enqueueEventCancelled).not.toHaveBeenCalled()
    expect(await rowsFor(jobId)).toHaveLength(0)
  })

  it('keeps a job the queue refused, and the relay hands it over later under the same job id', async () => {
    const jobId = `event-cancelled-relay-${STAMP}`
    vi.mocked(enqueueEventCancelled).mockRejectedValueOnce(new Error('Queue unavailable'))
    const req = await createLocalReq({}, payload)
    await initTransaction(req)
    await enqueueThroughOutbox(req, { job: cancelJob(3), jobId })
    await commitTransaction(req)

    let [row] = await rowsFor(jobId)
    expect(row.dispatchedAt).toBeFalsy()
    expect(row.attempts).toBe(1)
    expect(row.lastError).toContain('Queue unavailable')

    // Within the grace period the relay leaves it to the dispatch after commit.
    await processOutboxRelayJob()
    expect(enqueueEventCancelled).toHaveBeenCalledTimes(1)

    await ageRow(row.id)
    const result = await processOutboxRelayJob()
    expect(result.relayed).toBeGreaterThanOrEqual(1)
    const relayCall = vi.mocked(enqueueEventCancelled).mock.calls.find(([, options]) => options?.jobId === jobId)
    expect(relayCall).toBeTruthy()
    ;[row] = await rowsFor(jobId)
    expect(row.dispatchedAt).toBeTruthy()
    expect(row.attempts).toBe(2)
  })

  it('counts a job not in the queue ten minutes on as stuck', async () => {
    const jobId = `event-cancelled-stuck-${STAMP}`
    vi.mocked(enqueueEventCancelled).mockRejectedValue(new Error('Queue unavailable'))
    await enqueueThroughOutbox(await createLocalReq({}, payload), { job: cancelJob(4), jobId })
    const [row] = await rowsFor(jobId)
    await ageRow(row.id, 11 * 60 * 1000)

    const result = await processOutboxRelayJob()
    expect(result.stuck).toBeGreaterThanOrEqual(1)
    expect(result.failed).toBeGreaterThanOrEqual(1)

    vi.mocked(enqueueEventCancelled).mockResolvedValue(undefined as never)
    await processOutboxRelayJob()
    const [after] = await rowsFor(jobId)
    expect(after.dispatchedAt).toBeTruthy()
  })

  it('enqueueOrPark: straight to the queue, and only a refused job is parked', async () => {
    const queuedId = `send-email-queued-${STAMP}`
    const email: OutboxEnvelope = {
      jobType: JOB_NAMES.SEND_EMAIL,
      payload: { to: `outbox-${STAMP}@test.local`, subject: 'Akce zrušena', body: '<p>…</p>' },
    }
    expect(await enqueueOrPark(payload, { job: email, jobId: queuedId })).toBe('queued')
    expect(await rowsFor(queuedId)).toHaveLength(0)

    const parkedId = `send-email-parked-${STAMP}`
    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error('Queue unavailable'))
    expect(await enqueueOrPark(payload, { job: email, jobId: parkedId })).toBe('parked')
    const [row] = await rowsFor(parkedId)
    expect(row.dispatchedAt).toBeFalsy()
    expect(row.jobType).toBe(JOB_NAMES.SEND_EMAIL)
  })
})
