// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

// The queue is the one thing these tests don't talk to: the event hook's enqueue is captured and
// the worker's processor is run on it directly, against the test database. The processor sends
// through processEmailJob, which is stubbed so nothing reaches Resend.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueAttendanceReminder: vi.fn(async () => undefined),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueFeedbackRequest: vi.fn(async () => undefined),
  getQueue: vi.fn(() => ({ getJob: async () => undefined })),
}))
vi.mock('../../worker/src/processors/email.processor', () => ({
  processEmailJob: vi.fn(async () => ({ messageId: 'test-message' })),
}))

import { enqueueAttendanceReminder } from '@/lib/queue/queues'

import type { EmailJobData } from '@/lib/queue/contracts'

import { processAttendanceReminderJob } from '../../worker/src/processors/attendance-reminder.processor'
import { processEmailJob } from '../../worker/src/processors/email.processor'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type TestUser = { id: number; email: string }

describe('Attendance reminder checked by the worker', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: TestUser
  let participants: TestUser[]
  const eventIds: number[] = []

  const makeUser = (name: string): Promise<TestUser> =>
    payload.create({
      collection: 'users',
      data: { email: `attendance-reminder-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })

  /** Created upcoming (as the collection requires), then moved into the past straight in the DB. */
  const createPastEvent = async (registrationStatuses: ('approved' | 'pending')[] = []) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Attendance <event> ${STAMP}`,
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
    eventIds.push(event.id)
    const registrations = []
    for (const [i, status] of registrationStatuses.entries()) {
      registrations.push(
        await payload.create({
          collection: 'registrations',
          data: { event: event.id, user: participants[i].id, status },
          overrideAccess: true,
        }),
      )
    }
    await payload.db.updateOne({
      collection: 'events',
      id: event.id,
      data: {
        dateTime: new Date(Date.now() - 6 * HOUR).toISOString(),
        endDateTime: new Date(Date.now() - 4 * HOUR).toISOString(),
      },
    })
    vi.clearAllMocks()
    return { event, registrations }
  }

  const markAttendance = (registrationId: number, attendanceStatus: 'attended' | 'no_show') =>
    payload.db.updateOne({ collection: 'registrations', id: registrationId, data: { attendanceStatus } })

  const sentEmail = () => vi.mocked(processEmailJob).mock.calls.at(-1)?.[0] as EmailJobData

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Attendance ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Attendance ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await makeUser('organizer')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    participants = [await makeUser('p1'), await makeUser('p2')]
  })

  afterAll(async () => {
    const userIds = [organizer, ...participants].map((u) => u.id)
    for (const id of eventIds) {
      await payload.delete({ collection: 'registrations', where: { event: { equals: id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queues only the event id, a few hours after the end, when the event is created', async () => {
    const endDateTime = new Date(Date.now() + 2 * DAY).toISOString()
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Attendance queued ${STAMP}`,
        dateTime: new Date(Date.now() + DAY).toISOString(),
        endDateTime,
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
    eventIds.push(event.id)

    expect(enqueueAttendanceReminder).toHaveBeenCalledTimes(1)
    const [data, options] = vi.mocked(enqueueAttendanceReminder).mock.calls[0]
    expect(data).toEqual({ eventId: event.id })
    expect(options?.jobId).toBe(`attendance-reminder-${event.id}`)
    const firesAt = Date.now() + (options?.delay ?? 0)
    expect(Math.abs(firesAt - (new Date(endDateTime).getTime() + 3 * HOUR))).toBeLessThan(10_000)
  })

  it('e-mails the organizer while approved participants are still unmarked', async () => {
    const { event, registrations } = await createPastEvent(['approved', 'approved'])
    await markAttendance(registrations[0].id, 'attended')

    const result = await processAttendanceReminderJob({ eventId: event.id })

    expect(result).toMatchObject({ sent: true, messageId: 'test-message' })
    expect(processEmailJob).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    expect(email.to).toBe(organizer.email)
    expect(email.body).toContain('zbývá 1 z 2')
    expect(email.body).toContain(`/spravovat/${event.id}`)
    expect(email.body).toContain('&lt;event&gt;')
  })

  it('skips once every approved participant is marked', async () => {
    const { event, registrations } = await createPastEvent(['approved', 'approved'])
    await markAttendance(registrations[0].id, 'attended')
    await markAttendance(registrations[1].id, 'no_show')

    expect(await processAttendanceReminderJob({ eventId: event.id })).toEqual({ sent: false, skipped: 'already_marked' })
    expect(processEmailJob).not.toHaveBeenCalled()
  })

  it('skips an event nobody was approved for', async () => {
    const { event } = await createPastEvent(['pending'])

    expect(await processAttendanceReminderJob({ eventId: event.id })).toEqual({ sent: false, skipped: 'no_participants' })
    expect(processEmailJob).not.toHaveBeenCalled()
  })

  it('skips a cancelled, a deleted and a not-yet-over event', async () => {
    const { event: cancelled } = await createPastEvent(['approved'])
    await payload.db.updateOne({ collection: 'events', id: cancelled.id, data: { status: 'cancelled' } })
    expect(await processAttendanceReminderJob({ eventId: cancelled.id })).toEqual({ sent: false, skipped: 'event_gone' })

    expect(await processAttendanceReminderJob({ eventId: 999_999_999 })).toEqual({ sent: false, skipped: 'event_gone' })

    const { event: moved } = await createPastEvent(['approved'])
    await payload.db.updateOne({
      collection: 'events',
      id: moved.id,
      data: { dateTime: new Date(Date.now() + DAY).toISOString(), endDateTime: null },
    })
    expect(await processAttendanceReminderJob({ eventId: moved.id })).toEqual({ sent: false, skipped: 'event_not_over' })

    expect(processEmailJob).not.toHaveBeenCalled()
  })
})
