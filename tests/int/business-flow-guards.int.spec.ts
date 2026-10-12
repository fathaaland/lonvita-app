// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { createLocalReq, getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { POST as decideComplaint } from '@/app/api/review-complaints/[id]/decide/route'
import { removeOrganizerFromEvent } from '@/collections/shared/removeOrganizer'

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

/** The roles, requests and event flows that used to leave someone stuck or let a rule be skipped. */
describe('Business flow guards — roles, requests, cancelled events, handovers', () => {
  let muni: { id: number }
  let obecOnly: { id: number }
  let cat: { id: number }
  let platformAdmin: TestUser
  let admin: TestUser
  let admin2: TestUser
  let pub: TestUser
  let club: TestUser
  let resident: TestUser
  let volunteer: TestUser
  const userIds: number[] = []
  const eventIds: number[] = []
  const orgIdOf = new Map<number, number>()
  const relId = (value: unknown) => (value && typeof value === 'object' ? (value as { id: number }).id : (value as number))

  const makeUser = async (name: string, municipality: { id: number } | null, role: 'admin' | 'user' = 'user') => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `guards-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `guards ${name}`, municipality: municipality?.id ?? null, notifyEmail: false },
      overrideAccess: true,
    })
    userIds.push(user.id)
    return user as TestUser
  }
  const grant = (user: TestUser, municipality: { id: number }, role: 'organizer' | 'municipality_admin') =>
    payload.create({ collection: 'user-roles', data: { user: user.id, municipality: municipality.id, role }, overrideAccess: true })

  const eventData = (organizer: TestUser, extra: Record<string, unknown> = {}) => ({
    title: `Guards Event ${STAMP}`,
    dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
    locationText: 'Test location',
    lat: 49.5661,
    lng: 15.9403,
    capacity: 10,
    organizer: organizer.id,
    categories: [cat.id],
    municipality: muni.id,
    status: 'active' as const,
    isPaid: false,
    registrationApprovalMode: 'manual' as const,
    ...extra,
  })
  const createEvent = async (organizer: TestUser, extra: Record<string, unknown> = {}) => {
    const event = await payload.create({ collection: 'events', data: eventData(organizer, extra) as never, overrideAccess: true })
    eventIds.push(event.id)
    return event
  }
  /** A past event — the app never creates one, so straight through the adapter. */
  const createPastEvent = async (organizer: TestUser, organization: number) => {
    const event = await payload.db.create({
      collection: 'events',
      data: { ...eventData(organizer), dateTime: new Date(Date.now() - 2 * DAY).toISOString(), status: 'finished', organization },
    })
    eventIds.push(event.id)
    return event as { id: number }
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Guards Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    obecOnly = await payload.create({
      collection: 'municipalities',
      data: { name: `Guards Obec Only ${STAMP}`, rulesForCreation: 'municipality_only', lat: 49.6, lng: 15.95, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    cat = await payload.create({ collection: 'event-categories', data: { name: `Guards Category ${STAMP}` }, overrideAccess: true })

    platformAdmin = await makeUser('platform', null, 'admin')
    admin = await makeUser('admin', muni)
    admin2 = await makeUser('admin2', muni)
    pub = await makeUser('hospoda', muni)
    club = await makeUser('spolek', muni)
    resident = await makeUser('resident', muni)
    volunteer = await makeUser('dobrovolnik', muni)
    await grant(admin, muni, 'municipality_admin')
    await grant(admin2, muni, 'municipality_admin')
    await grant(pub, muni, 'organizer')
    await grant(club, muni, 'organizer')

    const orgs = await payload.find({ collection: 'organizations', where: { owner: { in: userIds } }, depth: 0, overrideAccess: true })
    for (const o of orgs.docs) orgIdOf.set(relId(o.owner), o.id)

    const profile = (await payload.find({ collection: 'profiles', where: { user: { equals: volunteer.id } }, overrideAccess: true })).docs[0]!
    await payload.update({
      collection: 'profiles',
      id: profile.id,
      data: {
        isVolunteer: true,
        volunteerMunicipality: muni.id,
        volunteerAllowEmail: true,
        volunteerContactEmail: `guards-dobrovolnik-${STAMP}@test.local`,
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const opts = { overrideAccess: true } as const
    await payload.delete({ collection: 'review-complaints', where: { municipality: { in: [muni.id, obecOnly.id] } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'event-feedback', where: { 'registration.event': { in: eventIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'event-deletion-requests', where: { event: { in: eventIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'organizer-requests', where: { user: { in: userIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { municipality: { in: [muni.id, obecOnly.id] } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, ...opts }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, ...opts }).catch(() => {})
    for (const m of [muni, obecOnly]) await payload.delete({ collection: 'municipalities', id: m.id, ...opts }).catch(() => {})
  })

  describe('roles', () => {
    it('a role is never rewritten — not into another role, not by the obec', async () => {
      const role = (
        await payload.find({ collection: 'user-roles', where: { user: { equals: admin.id } }, depth: 0, overrideAccess: true })
      ).docs[0]!
      await expect(
        payload.update({ collection: 'user-roles', id: role.id, data: { role: 'organizer' }, user: admin2, overrideAccess: false }),
      ).rejects.toThrow()
      const fresh = await payload.findByID({ collection: 'user-roles', id: role.id, overrideAccess: true })
      expect(fresh.role).toBe('municipality_admin')
    })

    it("only the platform admin appoints an obec's admin; the obec grants the organizer role", async () => {
      await expect(
        payload.create({
          collection: 'user-roles',
          data: { user: resident.id, municipality: muni.id, role: 'municipality_admin' },
          user: admin,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      const organizer = await payload.create({
        collection: 'user-roles',
        data: { user: resident.id, municipality: muni.id, role: 'organizer' },
        user: admin,
        overrideAccess: false,
      })
      expect(organizer.role).toBe('organizer')
      // Deleting the organization takes the role with it (Organizations cleanupOrganization).
      await payload.delete({ collection: 'organizations', where: { owner: { equals: resident.id } }, overrideAccess: true })
    })

    it("the obec's admin never holds the organizer role there too", async () => {
      await expect(grant(admin, muni, 'organizer')).rejects.toThrow(/Admin obce pořádá akce za obec/)
    })

    it("an admin's role stays while an event they founded for the obec is ahead", async () => {
      const event = await createEvent(admin2)
      const role = (
        await payload.find({
          collection: 'user-roles',
          where: { and: [{ user: { equals: admin2.id } }, { role: { equals: 'municipality_admin' } }] },
          overrideAccess: true,
        })
      ).docs[0]!
      await expect(
        payload.delete({ collection: 'user-roles', id: role.id, user: platformAdmin, overrideAccess: false }),
      ).rejects.toThrow(/Admin obce má v obci rozjetou akci/)

      await payload.update({ collection: 'events', id: event.id, data: { status: 'cancelled' }, user: admin, overrideAccess: false })
      await payload.delete({ collection: 'user-roles', id: role.id, user: platformAdmin, overrideAccess: false })
      await grant(admin2, muni, 'municipality_admin')
    })
  })

  describe('asking to organize', () => {
    it('only in the obec one lives in, never as its admin, and not where the obec founds its events itself', async () => {
      const ask = (user: TestUser, municipality: { id: number }) =>
        payload.create({
          collection: 'organizer-requests',
          data: {
            user: user.id,
            municipality: municipality.id,
            reason: 'Vedu místní spolek a chci pořádat akce.',
            organizationName: 'Spolek',
            organizationType: 'association',
            status: 'pending',
          },
          user,
          overrideAccess: false,
        })

      await expect(ask(resident, obecOnly)).rejects.toThrow(/domovské obci/)
      await expect(ask(admin, muni)).rejects.toThrow(/admin obce/)

      const residentProfile = (await payload.find({ collection: 'profiles', where: { user: { equals: resident.id } }, overrideAccess: true })).docs[0]!
      await payload.update({ collection: 'profiles', id: residentProfile.id, data: { municipality: obecOnly.id }, overrideAccess: true })
      await expect(ask(resident, obecOnly)).rejects.toThrow(/jen obec sama/)
      await payload.update({ collection: 'profiles', id: residentProfile.id, data: { municipality: muni.id }, overrideAccess: true })

      // Filed as already approved, it still waits on the obec.
      const request = await payload.create({
        collection: 'organizer-requests',
        data: {
          user: resident.id,
          municipality: muni.id,
          reason: 'Vedu místní spolek a chci pořádat akce.',
          organizationName: 'Spolek',
          organizationType: 'association',
          status: 'approved',
          reviewedBy: admin.id,
        },
        user: resident,
        overrideAccess: false,
      })
      expect(request.status).toBe('pending')
      expect(request.reviewedBy ?? null).toBeNull()
      // The obec decides on this person in this obec — a PATCH can't swap either.
      await payload.update({ collection: 'organizer-requests', id: request.id, data: { user: admin.id }, user: admin, overrideAccess: false })
      const fresh = await payload.findByID({ collection: 'organizer-requests', id: request.id, depth: 0, overrideAccess: true })
      expect(relId(fresh.user)).toBe(resident.id)
    })
  })

  describe('signing up', () => {
    it("is one's own, and starts where the event says — never self-approved past the organizer", async () => {
      const event = await createEvent(pub, { capacity: 1 })
      await expect(
        payload.create({
          collection: 'registrations',
          data: { event: event.id, user: volunteer.id, status: 'pending' },
          user: resident,
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      const own = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: resident.id, status: 'approved' },
        user: resident,
        overrideAccess: false,
      })
      expect(own.status).toBe('pending')
    })
  })

  describe('cancelled events', () => {
    it('take no sign-ups, and stay cancelled', async () => {
      const event = await createEvent(pub)
      await payload.update({ collection: 'events', id: event.id, data: { status: 'cancelled' }, user: pub, overrideAccess: false })
      const cancelled = await payload.findByID({ collection: 'events', id: event.id, overrideAccess: true })
      expect(cancelled.deletedAt).toBeTruthy()

      await expect(
        payload.create({ collection: 'registrations', data: { event: event.id, user: resident.id, status: 'pending' }, user: resident, overrideAccess: false }),
      ).rejects.toThrow(/zrušena/)
      await expect(
        payload.update({ collection: 'events', id: event.id, data: { deletedAt: null }, user: pub, overrideAccess: false }),
      ).rejects.toThrow()
    })
  })

  describe("the obec's radius", () => {
    it('shrinking it leaves events already placed editable and cancellable', async () => {
      const event = await createEvent(pub, { lat: 49.6461, lng: 15.9403 }) // ~9 km north
      await payload.update({ collection: 'municipalities', id: muni.id, data: { eventRadiusKm: 5 }, overrideAccess: true })
      try {
        const edited = await payload.update({ collection: 'events', id: event.id, data: { title: 'Přejmenováno' }, user: pub, overrideAccess: false })
        expect(edited.title).toBe('Přejmenováno')
        // Moving it is checked against the new radius.
        await expect(
          payload.update({ collection: 'events', id: event.id, data: { lat: 49.7, lng: 15.9403 }, user: pub, overrideAccess: false }),
        ).rejects.toThrow(/okruh/)
        const cancelled = await payload.update({
          collection: 'events',
          id: event.id,
          data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
          user: pub,
          overrideAccess: false,
        })
        expect(cancelled.deletedAt).toBeTruthy()
      } finally {
        await payload.update({ collection: 'municipalities', id: muni.id, data: { eventRadiusKm: 15 }, overrideAccess: true })
      }
    })
  })

  describe('the creator of an event the obec runs', () => {
    it("is the obec: any of its admins keeps attendance — not the spolupořadatel", async () => {
      const obecOrg = (
        await payload.find({
          collection: 'organizations',
          where: { and: [{ municipality: { equals: muni.id } }, { type: { equals: 'municipality' } }] },
          overrideAccess: true,
        })
      ).docs[0]!
      const event = await createPastEvent(admin, obecOrg.id)
      const registration = await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: resident.id, status: 'approved' },
        overrideAccess: true,
        context: { skipNotifications: true },
      })
      await expect(
        payload.update({ collection: 'registrations', id: registration.id, data: { attendanceStatus: 'attended' }, user: pub, overrideAccess: false }),
      ).rejects.toThrow()
      const marked = await payload.update({
        collection: 'registrations',
        id: registration.id,
        data: { attendanceStatus: 'attended' },
        user: admin2,
        overrideAccess: false,
      })
      expect(marked.attendanceStatus).toBe('attended')

      // A review of the obec's own event goes to the platform admin, not the obec.
      const feedback = await payload.create({
        collection: 'event-feedback',
        data: { registration: registration.id, satisfactionRating: 1, comment: 'Nic moc.' },
        overrideAccess: true,
      })
      const complaint = await payload.create({
        collection: 'review-complaints',
        data: { reviewType: 'event-feedback', eventFeedback: feedback.id, reason: 'Recenze je nepravdivá a urážlivá.' } as never,
        user: admin2,
        overrideAccess: false,
      })
      const decideAs = async (user: TestUser) => {
        const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
        return decideComplaint(
          new Request('http://localhost/api/x', {
            method: 'POST',
            headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uphold: false }),
          }),
          { params: Promise.resolve({ id: String(complaint.id) }) },
        )
      }
      expect((await decideAs(admin)).status).toBe(403)
      expect(await (await decideAs(platformAdmin)).json()).toEqual({ status: 'rejected' })
    })
  })

  describe('handing an event over', () => {
    it("takes the volunteers' offers along to the successor", async () => {
      const event = await createEvent(pub, { coOrganizations: [orgIdOf.get(club.id)], isVolunteering: true })
      const offer = await payload.create({
        collection: 'volunteer-invitations',
        data: { kind: 'application', event: event.id } as never,
        user: volunteer,
        overrideAccess: false,
      })
      expect(relId(offer.invitedBy)).toBe(pub.id)

      await removeOrganizerFromEvent(await createLocalReq({ user: club as never }, payload), event, pub.id, club.id)

      const handed = await payload.findByID({ collection: 'volunteer-invitations', id: offer.id, depth: 0, overrideAccess: true })
      expect(relId(handed.invitedBy)).toBe(club.id)
      await expect(
        payload.update({ collection: 'volunteer-invitations', id: offer.id, data: { status: 'accepted' }, user: pub, overrideAccess: false }),
      ).rejects.toThrow()
      const accepted = await payload.update({
        collection: 'volunteer-invitations',
        id: offer.id,
        data: { status: 'accepted' },
        user: club,
        overrideAccess: false,
      })
      expect(accepted.status).toBe('accepted')
    })
  })
})
