// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as getEventReliability } from '@/app/api/events/[id]/reliability/route'
import { GET as getOwnReliability } from '@/app/api/account/reliability/route'
import { reliabilityOf } from '@/collections/shared/reliability'
import { reliabilityLabel, summarizeReliability, type ReliabilityRecord } from '@/lib/reliability'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type TestUser = { id: number; email: string; role: string }

const plusMonths = (iso: string, months: number) => {
  const date = new Date(iso)
  date.setMonth(date.getMonth() + months)
  return date.toISOString()
}

describe('Who turns up — no-shows, omluvy and the soft limit on signing up', () => {
  describe('the counting itself', () => {
    const now = new Date('2027-06-15T12:00:00.000Z')
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString()

    it('counts the last 6 months only', () => {
      const record = summarizeReliability(
        [
          { kind: 'attended', at: at(10) },
          { kind: 'excused', at: at(40) },
          { kind: 'no_show', at: at(60) },
          { kind: 'no_show', at: at(200) },
        ],
        now,
      )
      expect(record).toEqual({ attended: 1, excused: 1, noShows: 1, restrictedUntil: null })
    })

    it('3 no-shows hold sign-ups until the oldest of the last three drops out of the window', () => {
      const record = summarizeReliability(
        [
          { kind: 'no_show', at: at(100) },
          { kind: 'no_show', at: at(50) },
          { kind: 'no_show', at: at(20) },
          { kind: 'no_show', at: at(10) },
        ],
        now,
      )
      expect(record.noShows).toBe(4)
      // Of four, the second oldest — after that only two are left.
      expect(record.restrictedUntil).toBe(plusMonths(at(50), 6))
    })

    it('labels: no-shows first, then frequent omluvy, then reliable — nothing for someone new', () => {
      const r = (attended: number, excused: number, noShows: number): ReliabilityRecord => ({
        attended,
        excused,
        noShows,
        restrictedUntil: null,
      })
      expect(reliabilityLabel(r(5, 5, 1))).toBe('no_shows')
      expect(reliabilityLabel(r(2, 3, 0))).toBe('frequent_excuses')
      expect(reliabilityLabel(r(3, 3, 0))).toBe('reliable')
      expect(reliabilityLabel(r(0, 2, 0))).toBe('reliable')
      expect(reliabilityLabel(r(0, 0, 0))).toBe('new')
    })
  })

  describe('in the app', () => {
    let muni: { id: number }
    let cat: { id: number }
    let organizer: TestUser
    let obecAdmin: TestUser
    let stranger: TestUser
    let repeat: TestUser
    let fine: TestUser
    let canceller: TestUser
    const userIds: number[] = []
    const eventIds: number[] = []

    const makeUser = async (name: string, role: 'organizer' | 'municipality_admin' | null = null): Promise<TestUser> => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `reliability-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      userIds.push(user.id)
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `Reliability ${name}`, municipality: muni.id, notifyEmail: false },
        overrideAccess: true,
      })
      if (role) {
        await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
      }
      return user
    }

    /** A trusted write — a past start can't be created through the app. */
    const eventStartingIn = async (ms: number, registrationApprovalMode: 'auto' | 'manual' = 'manual') => {
      const event = await payload.db.create({
        collection: 'events',
        data: {
          title: `Reliability ${STAMP}-${eventIds.length}`,
          dateTime: new Date(Date.now() + ms).toISOString(),
          locationText: 'Náves',
          lat: 49.5661,
          lng: 15.9403,
          capacity: 20,
          organizer: organizer.id,
          categories: [cat.id],
          municipality: muni.id,
          status: 'active',
          isPaid: false,
          registrationApprovalMode,
          coOrganizations: [],
          coOrganizers: [],
        },
      })
      eventIds.push(event.id)
      return event as { id: number; dateTime: string }
    }

    const registerApproved = (eventId: number, user: TestUser, role: 'participant' | 'volunteer' = 'participant') =>
      payload.create({
        collection: 'registrations',
        data: { event: eventId, user: user.id, status: 'approved', role },
        context: { skipNotifications: true },
        overrideAccess: true,
      })

    const markAs = (user: TestUser, registrationId: number, attendanceStatus: 'attended' | 'no_show' | 'excused' | 'not_marked') =>
      payload.update({
        collection: 'registrations',
        id: registrationId,
        data: { attendanceStatus },
        user,
        overrideAccess: false,
      })

    /** A no-show on an event `daysAgo`, marked by its organizer through access control. */
    const noShowAgo = async (user: TestUser, daysAgo: number) => {
      const event = await eventStartingIn(-daysAgo * DAY)
      const registration = await registerApproved(event.id, user)
      await markAs(organizer, registration.id, 'no_show')
      return { event, registration }
    }

    const notificationsOf = async (user: TestUser) =>
      (
        await payload.find({
          collection: 'notifications',
          where: { user: { equals: user.id } },
          sort: '-createdAt',
          overrideAccess: true,
        })
      ).docs

    const authHeaders = async (user: TestUser) => {
      const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
      return { Authorization: `JWT ${token}` }
    }

    const eventReliabilityAs = async (user: TestUser, eventId: number) =>
      getEventReliability(new Request(`http://localhost/api/events/${eventId}/reliability`, { headers: await authHeaders(user) }), {
        params: Promise.resolve({ id: String(eventId) }),
      })

    beforeAll(async () => {
      payload = await getPayload({ config: await config })
      muni = await payload.create({
        collection: 'municipalities',
        data: { name: `Test Reliability Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
        overrideAccess: true,
      })
      cat = await payload.create({
        collection: 'event-categories',
        data: { name: `Test Category Reliability ${STAMP}` },
        overrideAccess: true,
      })
      organizer = await makeUser('organizer', 'organizer')
      obecAdmin = await makeUser('obec', 'municipality_admin')
      stranger = await makeUser('stranger')
      repeat = await makeUser('repeat')
      fine = await makeUser('fine')
      canceller = await makeUser('canceller')
    })

    afterAll(async () => {
      await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'organizations', where: { municipality: { equals: muni.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
    })

    describe('no-shows', () => {
      it('the participant hears about one, kindly, with how to let the organizer know next time', async () => {
        await noShowAgo(repeat, 30)
        const [latest] = await notificationsOf(repeat)
        expect(latest.title).toBe('Nedorazil(a) jste na akci')
        expect(latest.message).toMatch(/odhlaste se prosím v aplikaci/)
        expect(await reliabilityOf(payload, repeat.id)).toMatchObject({ noShows: 1, restrictedUntil: null })
      })

      it('one older than 6 months no longer counts', async () => {
        const event = await eventStartingIn(-220 * DAY)
        const registration = await registerApproved(event.id, fine)
        await payload.db.updateOne({ collection: 'registrations', id: registration.id, data: { attendanceStatus: 'no_show' } })
        expect(await reliabilityOf(payload, fine.id)).toMatchObject({ noShows: 0 })
      })

      it('the third within 6 months — their sign-ups wait for the organizer, and they are told until when', async () => {
        await noShowAgo(repeat, 20)
        await noShowAgo(repeat, 10)
        const record = await reliabilityOf(payload, repeat.id)
        expect(record.noShows).toBe(3)
        expect(record.restrictedUntil).not.toBeNull()

        const [latest] = await notificationsOf(repeat)
        expect(latest.title).toBe('Přihlášky vám teď potvrzuje pořadatel')
        expect(latest.message).toMatch(/nedorazil\(a\) 3×/)
      })

      it('signing up for an event without approval then waits for the organizer, who is told why', async () => {
        const event = await eventStartingIn(7 * DAY, 'auto')
        const registration = await payload.create({
          collection: 'registrations',
          data: { event: event.id, user: repeat.id },
          user: repeat,
          overrideAccess: false,
        })
        expect(registration.status).toBe('pending')

        const [toParticipant] = await notificationsOf(repeat)
        expect(toParticipant.message).toMatch(/potvrzuje pořadatel/)
        const [toOrganizer] = await notificationsOf(organizer)
        expect(toOrganizer.message).toMatch(/3× nedorazil\(a\) bez omluvy/)
      })

      it('anyone else is still in straight away', async () => {
        const event = await eventStartingIn(7 * DAY, 'auto')
        const registration = await payload.create({
          collection: 'registrations',
          data: { event: event.id, user: fine.id },
          user: fine,
          overrideAccess: false,
        })
        expect(registration.status).toBe('approved')
      })
    })

    describe('omluvy', () => {
      it('giving up an approved place in time is one — counted, never held against anyone', async () => {
        const event = await eventStartingIn(2 * DAY)
        const registration = await registerApproved(event.id, canceller)
        const cancelled = await payload.update({
          collection: 'registrations',
          id: registration.id,
          data: { status: 'cancelled', excuseMessage: 'Jsem nemocná' },
          user: canceller,
          overrideAccess: false,
        })
        expect(cancelled.selfCancelled).toBe(true)
        expect(await reliabilityOf(payload, canceller.id)).toMatchObject({ excused: 1, noShows: 0, restrictedUntil: null })
      })

      it('withdrawing a sign-up still waiting for approval is not', async () => {
        const event = await eventStartingIn(2 * DAY)
        const registration = await payload.create({
          collection: 'registrations',
          data: { event: event.id, user: canceller.id, status: 'pending' },
          context: { skipNotifications: true },
          overrideAccess: true,
        })
        const cancelled = await payload.update({
          collection: 'registrations',
          id: registration.id,
          data: { status: 'cancelled' },
          user: canceller,
          overrideAccess: false,
        })
        expect(cancelled.selfCancelled).toBe(false)
      })

      it('nor is a cancellation the app makes itself, nor a client claiming one', async () => {
        const event = await eventStartingIn(2 * DAY)
        const registration = await registerApproved(event.id, canceller)
        const internal = await payload.update({
          collection: 'registrations',
          id: registration.id,
          data: { status: 'cancelled' },
          overrideAccess: true,
        })
        expect(internal.selfCancelled).toBe(false)

        const other = await registerApproved((await eventStartingIn(2 * DAY)).id, fine)
        const claimed = await payload.update({
          collection: 'registrations',
          id: other.id,
          data: { selfCancelled: true },
          user: fine,
          overrideAccess: false,
        })
        expect(claimed.selfCancelled).toBe(false)
      })

      it('calling the organizer, who marks them "Omluven/a", is one too', async () => {
        const event = await eventStartingIn(-5 * DAY)
        const registration = await registerApproved(event.id, canceller)
        await markAs(organizer, registration.id, 'excused')
        expect(await reliabilityOf(payload, canceller.id)).toMatchObject({ excused: 2, noShows: 0 })
      })
    })

    describe('who sees it', () => {
      it("the event's team sees the numbers of everyone signed up", async () => {
        const event = await eventStartingIn(3 * DAY)
        await registerApproved(event.id, repeat)
        await registerApproved(event.id, canceller)

        for (const viewer of [organizer, obecAdmin]) {
          const response = await eventReliabilityAs(viewer, event.id)
          expect(response.status).toBe(200)
          const body = await response.json()
          expect(body[String(repeat.id)]).toMatchObject({ noShows: 3 })
          expect(body[String(canceller.id)]).toMatchObject({ excused: 2, noShows: 0 })
        }
      })

      it('nobody else', async () => {
        const event = await eventStartingIn(3 * DAY)
        expect((await eventReliabilityAs(stranger, event.id)).status).toBe(403)
        expect((await eventReliabilityAs(repeat, event.id)).status).toBe(403)
      })

      it('everyone sees their own', async () => {
        const response = await getOwnReliability(
          new Request('http://localhost/api/account/reliability', { headers: await authHeaders(repeat) }),
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ noShows: 3 })
      })
    })

    describe('correcting a mistake', () => {
      let registration: { id: number }

      beforeAll(async () => {
        ;({ registration } = await noShowAgo(fine, 15))
      })

      it("the organizer can't change attendance once confirmed", async () => {
        await expect(markAs(organizer, registration.id, 'attended')).rejects.toThrow(/nejde/)
      })

      it("the obec's admin doesn't fill it in in the organizer's place", async () => {
        const event = await eventStartingIn(-3 * DAY)
        const unmarked = await registerApproved(event.id, stranger)
        await expect(markAs(obecAdmin, unmarked.id, 'attended')).rejects.toThrow(/jen pořadatel/)
      })

      it("but corrects a participant's confirmed attendance — it stops counting as a no-show", async () => {
        const corrected = await markAs(obecAdmin, registration.id, 'excused')
        expect(corrected.attendanceStatus).toBe('excused')
        expect(await reliabilityOf(payload, fine.id)).toMatchObject({ noShows: 0, excused: 1 })
      })

      it('only to another attendance, never back to unmarked', async () => {
        await expect(markAs(obecAdmin, registration.id, 'not_marked')).rejects.toThrow(/ne smazat/)
      })

      it("not a volunteer's — that's the event creator's alone", async () => {
        const event = await eventStartingIn(-3 * DAY)
        const volunteer = await registerApproved(event.id, stranger, 'volunteer')
        await markAs(organizer, volunteer.id, 'attended')
        await expect(markAs(obecAdmin, volunteer.id, 'no_show')).rejects.toThrow()
      })
    })
  })
})
