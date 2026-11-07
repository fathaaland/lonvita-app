// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { getEmailQueue, getQueue } from '@/lib/queue/queues'

import { processRestoreRemindersJob } from '../../worker/src/processors/restore-reminders.processor'

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

/** Reminders put back when Redis lost them — against the tests' own Redis DB (tests/redis.ts). */
describe('Restoring lost reminders (worker restore-reminders)', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: { id: number }
  let participant: { id: number }
  let event: { id: number }
  let registration: { id: number }

  const jobs = async () => ({
    attendance: await getQueue().getJob(`attendance-reminder-${event.id}`),
    reminder: await getEmailQueue().getJob(`reminder-${registration.id}`),
  })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni Restore ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `Restore ${STAMP}` }, overrideAccess: true })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `restore-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    participant = await payload.create({
      collection: 'users',
      data: { email: `restore-participant-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    event = await payload.create({
      collection: 'events',
      data: {
        title: `Restore ${STAMP}`,
        dateTime: new Date(Date.now() + 3 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      overrideAccess: true,
    })
    // Approved by the organizer — that's when its 24h reminder is planned.
    registration = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'pending' },
      overrideAccess: true,
    })
    await payload.update({ collection: 'registrations', id: registration.id, data: { status: 'approved' }, overrideAccess: true })
  })

  afterAll(async () => {
    const { attendance, reminder } = await jobs()
    await attendance?.remove().catch(() => {})
    await reminder?.remove().catch(() => {})
    await payload.delete({ collection: 'registrations', id: registration.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true }).catch(() => {})
    for (const id of [participant.id, organizer.id]) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('puts back the reminders Redis lost, at their original time', async () => {
    const before = await jobs()
    expect(before.attendance).toBeTruthy()
    expect(before.reminder).toBeTruthy()
    const firesAt = before.reminder!.timestamp + (before.reminder!.opts.delay ?? 0)

    await before.attendance!.remove()
    await before.reminder!.remove()

    const result = await processRestoreRemindersJob()
    expect(result.restored).toBeGreaterThanOrEqual(2)
    const after = await jobs()
    expect(after.attendance).toBeTruthy()
    expect(after.reminder).toBeTruthy()
    // The same moment — 24 h before the start —, give or take the time the test took.
    expect(Math.abs(after.reminder!.timestamp + (after.reminder!.opts.delay ?? 0) - firesAt)).toBeLessThan(60_000)
  })

  it('leaves everything as it is when nothing is missing', async () => {
    const result = await processRestoreRemindersJob()
    const mine = await jobs()
    expect(mine.attendance).toBeTruthy()
    expect(mine.reminder).toBeTruthy()
    expect(result.failed).toBe(0)
    // Whatever was missing (other test files' events, which queue nothing) is back after the first run.
    const again = await processRestoreRemindersJob()
    expect(again.restored).toBe(0)
  })
})
