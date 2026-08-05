import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

let municipality: { id: number }
let category: { id: number }
let organizer: { id: number; email: string; role: string }
let participant: { id: number; email: string; role: string }
let event: { id: number }

const STAMP = Date.now()

describe('Registrations & EventFeedback', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni Regs ${STAMP}` },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    participant = await payload.create({
      collection: 'users',
      data: { email: `participant-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    event = await payload.create({
      collection: 'events',
      data: {
        title: `Test Event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        category: category.id,
        status: 'active',
        isPaid: false,
        cancellationPolicy: 'none',
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'event-feedback', where: { user: { equals: participant.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: organizer.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: participant.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  describe('uniqueness and gating', () => {
    it('blocks a second active registration for the same user+event', async () => {
      const first = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'pending', paymentStatus: 'none' },
        overrideAccess: true,
      })

      await expect(
        payload.create({
          collection: 'registrations',
          data: { event: event.id, user: participant.id, status: 'pending', paymentStatus: 'none' },
          overrideAccess: true,
        }),
      ).rejects.toThrow(/already registered/)

      await payload.delete({ collection: 'registrations', id: first.id, overrideAccess: true })
    })

    it('allows re-registering after the earlier registration was cancelled', async () => {
      const cancelled = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'pending', paymentStatus: 'none' },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'registrations',
        id: cancelled.id,
        data: { status: 'cancelled' },
        overrideAccess: true,
      })

      const reRegistered = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'pending', paymentStatus: 'none' },
        overrideAccess: true,
      })
      expect(reRegistered.id).toBeDefined()

      await payload.delete({ collection: 'registrations', id: cancelled.id, overrideAccess: true })
      await payload.delete({ collection: 'registrations', id: reRegistered.id, overrideAccess: true })
    })

    it('a plain participant cannot hard-delete their own registration (admin-only delete)', async () => {
      const reg = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'pending', paymentStatus: 'none' },
        overrideAccess: true,
      })

      await expect(
        payload.delete({
          collection: 'registrations',
          id: reg.id,
          user: participant,
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      await payload.delete({ collection: 'registrations', id: reg.id, overrideAccess: true })
    })

    it('soft-deleted registrations are excluded from access-controlled reads', async () => {
      const reg = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'pending', paymentStatus: 'none' },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'registrations',
        id: reg.id,
        data: { deletedAt: new Date().toISOString() },
        overrideAccess: true,
      })

      const visible = await payload.find({
        collection: 'registrations',
        where: { id: { equals: reg.id } },
        user: participant,
        overrideAccess: false,
      })
      expect(visible.docs).toHaveLength(0)

      // ...but it still exists for admin/compliance tooling that explicitly overrides access.
      const stillThere = await payload.findByID({ collection: 'registrations', id: reg.id, overrideAccess: true })
      expect(stillThere.id).toBe(reg.id)

      await payload.delete({ collection: 'registrations', id: reg.id, overrideAccess: true })
    })
  })

  describe('EventFeedback — attendance gate', () => {
    let secondParticipant: { id: number }
    let notAttendedReg: { id: number }
    let attendedReg: { id: number }

    beforeAll(async () => {
      // Two different participants — one registration per (event, user) at a time is
      // enforced by Registrations' own uniqueness hook, so these can't share a user.
      secondParticipant = await payload.create({
        collection: 'users',
        data: { email: `participant-2-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      notAttendedReg = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'approved', paymentStatus: 'none', attendanceStatus: 'not_marked' },
        overrideAccess: true,
      })
      attendedReg = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: secondParticipant.id, status: 'approved', paymentStatus: 'none', attendanceStatus: 'attended' },
        overrideAccess: true,
      })
    })

    afterAll(async () => {
      await payload.delete({ collection: 'event-feedback', where: { registration: { in: [notAttendedReg.id, attendedReg.id] } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'registrations', id: notAttendedReg.id, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'registrations', id: attendedReg.id, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'users', id: secondParticipant.id, overrideAccess: true }).catch(() => {})
    })

    it('rejects feedback for a registration that was never marked attended', async () => {
      await expect(
        payload.create({
          collection: 'event-feedback',
          data: { registration: notAttendedReg.id, satisfactionRating: 5 },
          overrideAccess: true,
        }),
      ).rejects.toThrow(/attended/)
    })

    it('accepts feedback once the registration is marked attended', async () => {
      const feedback = await payload.create({
        collection: 'event-feedback',
        data: { registration: attendedReg.id, satisfactionRating: 5 },
        overrideAccess: true,
      })
      expect(feedback.id).toBeDefined()
    })

    it('rejects a second feedback entry for the same registration (unique)', async () => {
      await expect(
        payload.create({
          collection: 'event-feedback',
          data: { registration: attendedReg.id, satisfactionRating: 4 },
          overrideAccess: true,
        }),
      ).rejects.toThrow()
    })
  })
})
