// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

// The queue is the one thing these tests don't talk to: the hooks' enqueues are captured and the
// worker's processors are run on them directly, against the test database.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))
vi.mock('@/collections/shared/reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collections/shared/reminders')>()),
  rescheduleEventReminders: vi.fn(async () => undefined),
  cancelEventReminders: vi.fn(async () => undefined),
}))

import { cancelEventReminders, rescheduleEventReminders } from '@/collections/shared/reminders'
import { enqueueEmail, enqueueEventCancelled, enqueueEventUpdated, enqueueSms } from '@/lib/queue/queues'

import type { EventCancelledJobData, EventUpdatedJobData } from '@/lib/queue/contracts'

import { processEventCancelledJob } from '../../worker/src/processors/event-cancelled.processor'
import { processEventUpdatedJob } from '../../worker/src/processors/event-updated.processor'

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string }

describe('Event edit/cancel notifications fanned out by the worker', () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: TestUser
  /** Approved, has a phone. */
  let approved: TestUser
  /** Pending, wants no in-app notifications. */
  let pending: TestUser
  /** Rejected — not to be told anything. */
  let rejected: TestUser
  const eventIds: number[] = []

  const makeUser = async (name: string, profile?: Record<string, unknown>): Promise<TestUser> => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `event-notify-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    if (profile) {
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `Notify ${name}`, municipality: municipality.id, ...profile },
        overrideAccess: true,
      })
    }
    return user
  }

  const createEvent = async () => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Notify event ${STAMP}`,
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
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventIds.push(event.id)
    const registrations = []
    for (const [user, status] of [
      [approved, 'approved'],
      [pending, 'pending'],
      [rejected, 'rejected'],
    ] as const) {
      registrations.push(
        await payload.create({
          collection: 'registrations',
          data: { event: event.id, user: user.id, status },
          overrideAccess: true,
        }),
      )
    }
    // Registering sends its own e-mails ("nová přihláška") — not what these tests count.
    vi.clearAllMocks()
    return { event, registrationIds: registrations.map((r) => r.id) }
  }

  const edit = (id: number, data: Record<string, unknown>) =>
    payload.update({ collection: 'events', id, data, overrideAccess: true })

  const lastUpdatedJob = () => vi.mocked(enqueueEventUpdated).mock.calls.at(-1)?.[0] as EventUpdatedJobData
  const lastCancelledJob = () => vi.mocked(enqueueEventCancelled).mock.calls.at(-1)?.[0] as EventCancelledJobData

  const notificationsFor = async (user: TestUser, title: string) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { and: [{ user: { equals: user.id } }, { title: { equals: title } }] },
        pagination: false,
        overrideAccess: true,
      })
    ).docs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Event Notify ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Event Notify ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await makeUser('organizer')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    approved = await makeUser('approved', { phone: '735 929 442' })
    // Has switched both channels off — a change to the event reaches them anyway.
    pending = await makeUser('pending', { notifyInApp: false, notifyEmail: false })
    rejected = await makeUser('rejected')
  })

  afterAll(async () => {
    const userIds = [organizer, approved, pending, rejected].map((u) => u.id)
    for (const id of eventIds) {
      await payload.delete({ collection: 'registrations', where: { event: { equals: id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    const userIds = [organizer, approved, pending, rejected].map((u) => u.id)
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true })
  })

  describe('edits', () => {
    it('queues the pre-edit snapshot instead of notifying in the request', async () => {
      const { event } = await createEvent()
      await edit(event.id, { locationText: 'Sokolovna' })

      expect(vi.mocked(enqueueEventUpdated)).toHaveBeenCalledTimes(1)
      expect(lastUpdatedJob()).toMatchObject({ eventId: event.id, before: { locationText: '"Náves"' } })
      expect(await notificationsFor(approved, 'Akce byla upravena')).toHaveLength(0)
      expect(vi.mocked(enqueueEmail)).not.toHaveBeenCalled()
    })

    it('queues nothing for fields participants never see', async () => {
      const { event } = await createEvent()
      await edit(event.id, { isHidden: true })
      expect(vi.mocked(enqueueEventUpdated)).not.toHaveBeenCalled()
    })

    it('tells pending and approved registrants whatever their preferences, the organizer and rejected nobody', async () => {
      const { event } = await createEvent()
      await edit(event.id, { locationText: 'Sokolovna' })

      const result = await processEventUpdatedJob(lastUpdatedJob(), { jobId: '42' })
      expect(result).toEqual({ notified: 2 })

      const [notification] = await notificationsFor(approved, 'Akce byla upravena')
      expect(notification.message).toContain('změna: místo konání')
      expect(notification.message).toContain('Sokolovna')
      expect(notification.link).toBe(`/akce/${event.id}`)
      // Both channels off, still told — the event they signed up for changed.
      expect(await notificationsFor(pending, 'Akce byla upravena')).toHaveLength(1)
      expect(await notificationsFor(rejected, 'Akce byla upravena')).toHaveLength(0)
      expect(await notificationsFor(organizer, 'Akce byla upravena')).toHaveLength(0)

      const emailed = vi.mocked(enqueueEmail).mock.calls.map(([data, options]) => ({ to: data.to, jobId: options?.jobId }))
      expect(emailed).toHaveLength(2)
      expect(emailed).toEqual(
        expect.arrayContaining([
          { to: approved.email, jobId: `event-updated-${event.id}-42-email-${approved.id}` },
          { to: pending.email, jobId: `event-updated-${event.id}-42-email-${pending.id}` },
        ]),
      )

      // SMS go out only when an event is cancelled — an edit is in-app and e-mail only.
      expect(vi.mocked(enqueueSms)).not.toHaveBeenCalled()
      // Nothing about the time changed.
      expect(vi.mocked(rescheduleEventReminders)).not.toHaveBeenCalled()
    })

    it('reschedules reminders when the time moves', async () => {
      const { event } = await createEvent()
      await edit(event.id, { dateTime: new Date(Date.now() + 4 * DAY).toISOString() })

      await processEventUpdatedJob(lastUpdatedJob())
      expect(vi.mocked(rescheduleEventReminders)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: event.id }),
      )
      const [notification] = await notificationsFor(approved, 'Akce byla upravena')
      expect(notification.message).toContain('změna: začátek')
    })

    it('says nothing when the edit was undone before the job ran', async () => {
      const { event } = await createEvent()
      await edit(event.id, { locationText: 'Sokolovna' })
      const job = lastUpdatedJob()
      await edit(event.id, { locationText: 'Náves' })

      expect(await processEventUpdatedJob(job)).toEqual({ notified: 0, skipped: 'no_changes' })
      expect(await notificationsFor(approved, 'Akce byla upravena')).toHaveLength(0)
      expect(vi.mocked(enqueueEmail)).not.toHaveBeenCalled()
    })

    it('leaves a since-cancelled event to the cancellation job', async () => {
      const { event } = await createEvent()
      await edit(event.id, { locationText: 'Sokolovna' })
      const job = lastUpdatedJob()
      await edit(event.id, { deletedAt: new Date().toISOString(), status: 'cancelled' })

      expect(await processEventUpdatedJob(job)).toEqual({ notified: 0, skipped: 'event_cancelled' })
      expect(await notificationsFor(approved, 'Akce byla upravena')).toHaveLength(0)
    })
  })

  describe('cancellation', () => {
    it('queues the registrants and every registration, then tells them and drops the reminders', async () => {
      const { event, registrationIds } = await createEvent()
      await edit(event.id, { deletedAt: new Date().toISOString(), status: 'cancelled' })

      expect(vi.mocked(enqueueEventUpdated)).not.toHaveBeenCalled()
      const job = lastCancelledJob()
      expect(job.eventId).toBe(event.id)
      expect(job.userIds.map(Number).sort()).toEqual([approved.id, pending.id].sort())
      expect(job.registrationIds.map(Number).sort()).toEqual([...registrationIds].sort())

      expect(await processEventCancelledJob(job, { jobId: '7' })).toEqual({ notified: 2 })
      expect(vi.mocked(cancelEventReminders)).toHaveBeenCalledWith(event.id, job.registrationIds)
      const [notification] = await notificationsFor(approved, 'Akce byla zrušena')
      expect(notification.message).toContain(event.title)
      expect(vi.mocked(enqueueEmail)).toHaveBeenCalledTimes(2)
      expect(vi.mocked(enqueueSms).mock.calls[0][0]).toMatchObject({
        message: `Lonvita: akce „${event.title}“ byla zrušena.`,
      })
    })

    it("withdraws volunteers' pending invitations and offers, and tells those volunteers too", async () => {
      const { event } = await createEvent()
      const volunteer = await makeUser('volunteer')
      // Straight to the database — the invitation's own checks (pool, creator) aren't what's tested.
      const invitation = await payload.db.create({
        collection: 'volunteer-invitations',
        data: {
          kind: 'invitation',
          event: event.id,
          eventTitle: event.title,
          volunteer: volunteer.id,
          invitedBy: organizer.id,
          status: 'pending',
        },
      })

      await edit(event.id, { deletedAt: new Date().toISOString(), status: 'cancelled' })

      const stored = await payload.findByID({ collection: 'volunteer-invitations', id: invitation.id, overrideAccess: true })
      expect(stored.status).toBe('withdrawn')
      const job = lastCancelledJob()
      expect(job.volunteerUserIds?.map(Number)).toEqual([volunteer.id])

      await processEventCancelledJob(job, { jobId: '8' })
      const [notice] = await notificationsFor(volunteer, 'Akce byla zrušena')
      expect(notice.message).toMatch(/dobrovoln/)

      await payload.delete({ collection: 'notifications', where: { user: { equals: volunteer.id } }, overrideAccess: true })
      await payload.delete({ collection: 'volunteer-invitations', id: invitation.id, overrideAccess: true })
      await payload.delete({ collection: 'users', id: volunteer.id, overrideAccess: true })
    })

    it('stays quiet if the cancel never took effect', async () => {
      const { event, registrationIds } = await createEvent()
      const job: EventCancelledJobData = {
        eventId: event.id,
        title: event.title,
        userIds: [approved.id],
        registrationIds,
      }
      expect(await processEventCancelledJob(job)).toEqual({ notified: 0, skipped: 'not_cancelled' })
      expect(vi.mocked(cancelEventReminders)).not.toHaveBeenCalled()
      expect(await notificationsFor(approved, 'Akce byla zrušena')).toHaveLength(0)
    })

    it('still notifies from the snapshot once the event is hard-deleted', async () => {
      const job: EventCancelledJobData = {
        eventId: 999_999_999,
        title: 'Smazaná akce',
        userIds: [approved.id],
        registrationIds: [123],
      }
      expect(await processEventCancelledJob(job)).toEqual({ notified: 1 })
      expect(vi.mocked(cancelEventReminders)).toHaveBeenCalledWith(999_999_999, [123])
      expect(await notificationsFor(approved, 'Akce byla zrušena')).toHaveLength(1)
    })
  })
})
