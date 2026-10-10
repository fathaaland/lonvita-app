// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

// The attendance reminder sends through processEmailJob — stubbed so nothing reaches Resend.
vi.mock('../../worker/src/processors/email.processor', () => ({
  processEmailJob: vi.fn(async () => ({ messageId: 'test-message' })),
}))

import { GET as getVolunteer } from '@/app/api/volunteers/[userId]/route'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'

import { processAttendanceReminderJob } from '../../worker/src/processors/attendance-reminder.processor'
import { processEmailJob } from '../../worker/src/processors/email.processor'
import { processFeedbackRequestJob } from '../../worker/src/processors/feedback-request.processor'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe('An event with unlimited capacity keeps no attendance — the volunteers are only rated', () => {
  let muni: { id: number }
  let cat: { id: number }
  let pub: TestUser
  let club: TestUser
  let volunteer: TestUser
  let leftVolunteer: TestUser
  let participant: TestUser
  let pastEvent: { id: number }
  let volunteerRegistration: { id: number }
  let leftVolunteerRegistration: { id: number }
  let participantRegistration: { id: number }
  let leftParticipant: TestUser
  let leftParticipantRegistration: { id: number }
  const eventIds: number[] = []

  const tokenOf = async (user: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })).token

  const rate = (user: TestUser, registration: number, rating = 5) =>
    payload.create({
      collection: 'volunteer-ratings',
      data: { registration, rating } as never,
      user,
      overrideAccess: false,
    })

  const markAttendance = (user: TestUser, registration: number) =>
    payload.update({
      collection: 'registrations',
      id: registration,
      data: { attendanceStatus: 'attended' },
      user,
      overrideAccess: false,
      context: { skipNotifications: true },
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Unlimited Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Unlimited ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (
      name: string,
      role: 'organizer' | 'participant',
      profile: Record<string, unknown> = {},
    ): Promise<TestUser> => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `unlim-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `unlim ${name}`, municipality: muni.id, notifyEmail: false, ...profile },
        overrideAccess: true,
      })
      await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
      return user
    }
    const volunteerProfile = {
      isVolunteer: true,
      volunteerMunicipality: muni.id,
      volunteerFocus: ['akce'],
      volunteerAllowEmail: true,
      volunteerContactEmail: `unlim-contact-${STAMP}@test.local`,
    }
    pub = await makeUser('hospoda', 'organizer')
    club = await makeUser('spolek', 'organizer')
    volunteer = await makeUser('dobrovolnik', 'participant', volunteerProfile)
    leftVolunteer = await makeUser('odhlaseny', 'participant', volunteerProfile)
    participant = await makeUser('ucastnik', 'participant')
    leftParticipant = await makeUser('odhlaseny-ucastnik', 'participant')

    // An unlimited event that has already started, founded by the pub and co-organized by the club —
    // a trusted write, since a past start can't be created through the app.
    const orgs = await payload.find({
      collection: 'organizations',
      where: { municipality: { equals: muni.id } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const orgOf = (user: TestUser) =>
      orgs.docs.find((o) => (typeof o.owner === 'object' ? o.owner?.id : o.owner) === user.id)!.id
    pastEvent = await payload.db.create({
      collection: 'events',
      data: {
        title: `Unlimited Event ${STAMP}`,
        dateTime: new Date(Date.now() - 8 * HOUR).toISOString(),
        endDateTime: new Date(Date.now() - 6 * HOUR).toISOString(),
        locationText: 'Náměstí',
        lat: 49.5661,
        lng: 15.9403,
        capacity: UNLIMITED_CAPACITY,
        organizer: pub.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'finished',
        isPaid: false,
        registrationApprovalMode: 'auto',
        organization: orgOf(pub),
        coOrganizations: [orgOf(club)],
        coOrganizers: [club.id],
      },
    })
    eventIds.push(pastEvent.id)

    const register = (user: TestUser, data: Record<string, unknown>) =>
      payload.create({
        collection: 'registrations',
        data: { event: pastEvent.id, user: user.id, attendanceStatus: 'not_marked', ...data } as never,
        overrideAccess: true,
        context: { skipNotifications: true },
      })
    volunteerRegistration = await register(volunteer, { role: 'volunteer', status: 'approved' })
    leftVolunteerRegistration = await register(leftVolunteer, { role: 'volunteer', status: 'cancelled' })
    participantRegistration = await register(participant, { status: 'approved' })
    // Auto-approval sets a new participant's status itself — cancelled is where they end up after.
    leftParticipantRegistration = await payload.update({
      collection: 'registrations',
      id: (await register(leftParticipant, {})).id,
      data: { status: 'cancelled' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
  })

  afterAll(async () => {
    const userIds = [pub.id, club.id, volunteer.id, leftVolunteer.id, participant.id, leftParticipant.id]
    await payload.delete({ collection: 'volunteer-ratings', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-feedback', where: { registration: { in: [participantRegistration.id] } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  it('nobody marks attendance on it — not even the pořadatel who founded it', async () => {
    await expect(markAttendance(pub, participantRegistration.id)).rejects.toThrow(/neomezenou kapacitou/)
    await expect(markAttendance(pub, volunteerRegistration.id)).rejects.toThrow(/neomezenou kapacitou/)
    const stored = await payload.findByID({ collection: 'registrations', id: participantRegistration.id, overrideAccess: true })
    expect(stored.attendanceStatus).toBe('not_marked')
  })

  it('the pořadatel rates a volunteer straight away, without attendance — once', async () => {
    await expect(rate(club, volunteerRegistration.id)).rejects.toThrow(/založil/)
    const rating = await rate(pub, volunteerRegistration.id, 4)
    expect(rating).toMatchObject({ rating: 4, volunteer: expect.anything() })
    await expect(rate(pub, volunteerRegistration.id)).rejects.toThrow(/už/)
  })

  it('not a volunteer who cancelled before the event', async () => {
    await expect(rate(pub, leftVolunteerRegistration.id)).rejects.toThrow(/nebyl/)
  })

  const rateEvent = (user: TestUser, registration: number) =>
    payload.create({
      collection: 'event-feedback',
      data: { registration, satisfactionRating: 5 } as never,
      user,
      overrideAccess: false,
    })

  it('is rated by whoever stayed signed up for it — there is no attendance to wait for', async () => {
    const feedback = await rateEvent(participant, participantRegistration.id)
    expect(feedback.satisfactionRating).toBe(5)
  })

  it('not by someone who cancelled before it', async () => {
    await expect(rateEvent(leftParticipant, leftParticipantRegistration.id)).rejects.toThrow(/byli přihlášení/)
  })

  it('asks a participant who stayed signed up to rate it once it is over — and nobody who cancelled', async () => {
    await payload.delete({ collection: 'event-feedback', where: { registration: { equals: participantRegistration.id } }, overrideAccess: true })
    expect(await processFeedbackRequestJob({ registrationId: participantRegistration.id })).toEqual({ sent: true })
    expect((await processFeedbackRequestJob({ registrationId: leftParticipantRegistration.id })).sent).toBe(false)
  })

  it('the organizer is not reminded to fill in attendance', async () => {
    expect(await processAttendanceReminderJob({ eventId: pastEvent.id })).toEqual({
      sent: false,
      skipped: 'unlimited_capacity',
    })
    expect(processEmailJob).not.toHaveBeenCalled()
  })

  it("the volunteer's card counts the event as one they helped on", async () => {
    const response = await getVolunteer(
      new Request(`http://localhost/api/volunteers/${volunteer.id}`, {
        headers: { Authorization: `JWT ${await tokenOf(club)}` },
      }),
      { params: Promise.resolve({ userId: String(volunteer.id) }) },
    )
    expect(response.status).toBe(200)
    const card = (await response.json()) as { events: { id: string; attended: boolean }[] }
    expect(card.events).toEqual([expect.objectContaining({ id: String(pastEvent.id), attended: true })])
  })
})
