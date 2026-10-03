// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as getReviews } from '@/app/api/organizations/[id]/reviews/route'
import { GET as getFeedbackSummary } from '@/app/api/organizations/[id]/feedback-summary/route'
import { GET as getQueue } from '@/app/api/municipalities/[id]/review-complaints/route'
import { POST as decide } from '@/app/api/review-complaints/[id]/decide/route'
import { GET as getVolunteer } from '@/app/api/volunteers/[userId]/route'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

type ReviewRow = { id: string; satisfaction: number; complaint_status: string | null; can_complain: boolean } & Record<
  string,
  unknown
>

describe('Complaints about reviews (ReviewComplaints) — reported by the reviewed, decided by the obec', () => {
  let muni: { id: number }
  let cat: { id: number }
  let pub: TestUser
  let club: TestUser
  let otherOrganizer: TestUser
  let volunteer: TestUser
  let happy: TestUser
  let grumpy: TestUser
  let obecAdmin: TestUser
  let pubOrgId: number
  let event: { id: number }
  let goodFeedback: { id: number }
  let badFeedback: { id: number }
  let rating: { id: number }
  const eventIds: number[] = []

  const tokenOf = async (user: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })).token
  const auth = async (user: TestUser) => ({ Authorization: `JWT ${await tokenOf(user)}` })

  const reviewsAs = async (viewer: TestUser) => {
    const response = await getReviews(new Request('http://localhost/api/organizations/x/reviews', { headers: await auth(viewer) }), {
      params: Promise.resolve({ id: String(pubOrgId) }),
    })
    return { status: response.status, docs: ((await response.json()) as { docs: ReviewRow[] }).docs }
  }

  const summaryAs = async (viewer: TestUser) =>
    (await (
      await getFeedbackSummary(new Request('http://localhost/api/x', { headers: await auth(viewer) }), {
        params: Promise.resolve({ id: String(pubOrgId) }),
      })
    ).json()) as { count: number; avg_satisfaction: number | null }

  const decideAs = async (viewer: TestUser, complaintId: number | string, uphold: boolean, note?: string) =>
    decide(
      new Request('http://localhost/api/x', {
        method: 'POST',
        headers: { ...(await auth(viewer)), 'Content-Type': 'application/json' },
        body: JSON.stringify({ uphold, note }),
      }),
      { params: Promise.resolve({ id: String(complaintId) }) },
    )

  const complain = (
    user: TestUser,
    review: { type: 'event-feedback' | 'volunteer-rating'; id: number },
    reason = 'Tahle recenze je nespravedlivá a nepravdivá.',
  ) =>
    payload.create({
      collection: 'review-complaints',
      data: {
        reviewType: review.type,
        [review.type === 'event-feedback' ? 'eventFeedback' : 'volunteerRating']: review.id,
        reason,
      } as never,
      user,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Complaint Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Complaint ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, role: 'organizer' | 'participant' | 'municipality_admin') => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `rc-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `rc ${name}`, municipality: muni.id, notifyEmail: false },
        overrideAccess: true,
      })
      await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
      return user as TestUser
    }
    pub = await makeUser('hospoda', 'organizer')
    club = await makeUser('spolek', 'organizer')
    otherOrganizer = await makeUser('cizi', 'organizer')
    volunteer = await makeUser('dobrovolnik', 'participant')
    happy = await makeUser('spokojeny', 'participant')
    grumpy = await makeUser('nespokojeny', 'participant')
    obecAdmin = await makeUser('obec', 'municipality_admin')

    const orgs = await payload.find({
      collection: 'organizations',
      where: { municipality: { equals: muni.id } },
      depth: 0,
      overrideAccess: true,
    })
    const orgOf = (user: TestUser) =>
      orgs.docs.find((o) => (typeof o.owner === 'object' ? o.owner?.id : o.owner) === user.id)!.id
    pubOrgId = orgOf(pub)

    // A past event run by the pub with the club — set up as a trusted write, since a past start
    // can't be created through the app.
    event = await payload.db.create({
      collection: 'events',
      data: {
        title: `Complaint Event ${STAMP}`,
        dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: pub.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'finished',
        isPaid: false,
        registrationApprovalMode: 'manual',
        cancellationPolicy: 'none',
        organization: pubOrgId,
        coOrganizations: [orgOf(club)],
        coOrganizers: [club.id],
      },
    })
    eventIds.push(event.id)

    const attend = (user: TestUser, role: 'participant' | 'volunteer') =>
      payload.create({
        collection: 'registrations',
        data: { event: event.id, user: user.id, role, status: 'approved', attendanceStatus: 'attended' },
        overrideAccess: true,
        context: { skipNotifications: true },
      })
    const happyReg = await attend(happy, 'participant')
    const grumpyReg = await attend(grumpy, 'participant')
    const volunteerReg = await attend(volunteer, 'volunteer')

    goodFeedback = await payload.create({
      collection: 'event-feedback',
      data: { registration: happyReg.id, satisfactionRating: 5, comment: 'Skvělá akce!' },
      overrideAccess: true,
    })
    badFeedback = await payload.create({
      collection: 'event-feedback',
      data: { registration: grumpyReg.id, satisfactionRating: 1, comment: 'Hrozné, pořadatel je podvodník.' },
      overrideAccess: true,
    })
    rating = await payload.create({
      collection: 'volunteer-ratings',
      data: { registration: volunteerReg.id, rating: 2, comment: 'Přišel pozdě.' } as never,
      user: pub,
      overrideAccess: false,
    })
  })

  afterAll(async () => {
    const userIds = [pub.id, club.id, otherOrganizer.id, volunteer.id, happy.id, grumpy.id, obecAdmin.id]
    await payload.delete({ collection: 'review-complaints', where: { municipality: { equals: muni.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-feedback', where: { 'registration.event': { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'volunteer-ratings', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { municipality: { equals: muni.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { targetCollection: { equals: 'review-complaints' } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  it("the organization's reviews come one by one, without who wrote them", async () => {
    const { status, docs } = await reviewsAs(pub)
    expect(status).toBe(200)
    expect(docs.map((d) => d.satisfaction).sort()).toEqual([1, 5])
    for (const doc of docs) {
      expect(Object.keys(doc).sort()).toEqual(
        [
          'can_complain',
          'comment',
          'complaint_status',
          'created_at',
          'event_date',
          'event_id',
          'event_title',
          'felt_welcome',
          'id',
          'satisfaction',
        ].sort(),
      )
      expect(doc.can_complain).toBe(true)
    }
    // The obec reads them too, but decides instead of reporting.
    const asObec = await reviewsAs(obecAdmin)
    expect(asObec.docs.every((d) => !d.can_complain)).toBe(true)
    expect((await reviewsAs(otherOrganizer)).status).toBe(403)
  })

  it('only whoever runs the event reports its feedback — not a participant, another organizer or the obec', async () => {
    const bad = { type: 'event-feedback' as const, id: badFeedback.id }
    await expect(complain(grumpy, bad)).rejects.toThrow(/nahlásit nemůžete/)
    await expect(complain(otherOrganizer, bad)).rejects.toThrow(/nahlásit nemůžete/)
    await expect(complain(volunteer, bad)).rejects.toThrow(/nahlásit nemůžete/)
    await expect(complain(obecAdmin, bad)).rejects.toThrow(/nahlásit nemůžete/)
    await expect(complain(pub, bad, 'Krátké')).rejects.toThrow(/aspoň/)
  })

  it('a reported review waits for the obec, once — the queue shows the review, its author and the reason', async () => {
    const complaint = await complain(club, { type: 'event-feedback', id: badFeedback.id })
    expect(complaint).toMatchObject({ status: 'pending', complainant: expect.anything() })
    await expect(complain(pub, { type: 'event-feedback', id: badFeedback.id })).rejects.toThrow(/čeká/)

    const bad = (await reviewsAs(pub)).docs.find((d) => d.id === String(badFeedback.id))!
    expect(bad).toMatchObject({ complaint_status: 'pending', can_complain: false })

    const queue = await getQueue(new Request('http://localhost/api/x', { headers: await auth(obecAdmin) }), {
      params: Promise.resolve({ id: String(muni.id) }),
    })
    expect(queue.status).toBe(200)
    const rows = ((await queue.json()) as { docs: Record<string, unknown>[] }).docs
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      review_type: 'event-feedback',
      complainant_name: 'rc spolek',
      review: { rating: 1, comment: 'Hrozné, pořadatel je podvodník.', author_name: 'rc nespokojeny' },
    })
    const asOrganizer = await getQueue(new Request('http://localhost/api/x', { headers: await auth(pub) }), {
      params: Promise.resolve({ id: String(muni.id) }),
    })
    expect(asOrganizer.status).toBe(403)
  })

  it("upholding removes the review and the organization's score is recomputed without it", async () => {
    expect(await summaryAs(pub)).toMatchObject({ count: 2, avg_satisfaction: 3 })
    const complaint = (
      await payload.find({
        collection: 'review-complaints',
        where: { eventFeedback: { equals: badFeedback.id } },
        overrideAccess: true,
      })
    ).docs[0]!

    expect((await decideAs(club, complaint.id, true)).status).toBe(403)
    const response = await decideAs(obecAdmin, complaint.id, true, 'Urážlivé.')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'upheld' })
    expect((await decideAs(obecAdmin, complaint.id, false)).status).toBe(409)

    expect(await summaryAs(pub)).toMatchObject({ count: 1, avg_satisfaction: 5 })
    expect((await reviewsAs(pub)).docs.map((d) => d.id)).toEqual([String(goodFeedback.id)])
    // The review is soft-deleted, not gone.
    const stored = await payload.findByID({ collection: 'event-feedback', id: badFeedback.id, overrideAccess: true })
    expect(stored.deletedAt).toBeTruthy()

    const told = await payload.find({
      collection: 'notifications',
      where: { and: [{ user: { equals: club.id } }, { title: { equals: 'Recenze odstraněna' } }] },
      overrideAccess: true,
    })
    expect(told.totalDocs).toBe(1)
    expect(told.docs[0]!.message).toContain('Urážlivé.')
    // The review's author isn't told.
    const authorTold = await payload.count({ collection: 'notifications', where: { user: { equals: grumpy.id } }, overrideAccess: true })
    expect(authorTold.totalDocs).toBe(0)
  })

  it("only the volunteer reports their rating; a rejected complaint keeps it and can't be filed again", async () => {
    const theRating = { type: 'volunteer-rating' as const, id: rating.id }
    await expect(complain(pub, theRating)).rejects.toThrow(/nahlásit nemůžete/)
    await expect(complain(club, theRating)).rejects.toThrow(/nahlásit nemůžete/)

    const cardOf = async (viewer: TestUser) =>
      (await (
        await getVolunteer(new Request('http://localhost/api/x', { headers: await auth(viewer) }), {
          params: Promise.resolve({ userId: String(volunteer.id) }),
        })
      ).json()) as {
        volunteer: { rating: { average: number; count: number } | null }
        ratings: { id: string; complaint_status: string | null; can_complain: boolean }[]
      }

    // Only once they're in the pool does the card exist.
    await payload.update({
      collection: 'profiles',
      where: { user: { equals: volunteer.id } },
      data: { isVolunteer: true, volunteerMunicipality: muni.id, volunteerFocus: ['akce'], volunteerAllowEmail: true, volunteerContactEmail: `rc-c-${STAMP}@test.local` },
      overrideAccess: true,
    })
    expect((await cardOf(volunteer)).ratings[0]).toMatchObject({ complaint_status: null, can_complain: true })
    // Nobody else learns of the complaint.
    expect((await cardOf(pub)).ratings[0]).toMatchObject({ complaint_status: null, can_complain: false })

    const complaint = await complain(volunteer, theRating)
    expect((await cardOf(volunteer)).ratings[0]).toMatchObject({ complaint_status: 'pending', can_complain: false })

    const response = await decideAs(obecAdmin, complaint.id, false)
    expect(await response.json()).toEqual({ status: 'rejected' })
    const card = await cardOf(volunteer)
    expect(card.volunteer.rating).toEqual({ average: 2, count: 1 })
    expect(card.ratings[0]).toMatchObject({ complaint_status: 'rejected', can_complain: false })
    await expect(complain(volunteer, theRating)).rejects.toThrow(/ponechala/)
  })

  it('an upheld rating drops out of the volunteer average', async () => {
    // Upholding sets the same soft delete as here (the event-feedback test above goes through the
    // endpoint) — the average and the list are computed from what's left.
    await payload.update({ collection: 'volunteer-ratings', id: rating.id, data: { deletedAt: new Date().toISOString() }, overrideAccess: true })
    const card = (await (
      await getVolunteer(new Request('http://localhost/api/x', { headers: await auth(pub) }), {
        params: Promise.resolve({ userId: String(volunteer.id) }),
      })
    ).json()) as { volunteer: { rating: unknown }; ratings: unknown[] }
    expect(card.volunteer.rating).toBeNull()
    expect(card.ratings).toHaveLength(0)
    const asOrganizer = await payload.find({ collection: 'volunteer-ratings', where: { id: { equals: rating.id } }, user: pub, overrideAccess: false })
    expect(asOrganizer.totalDocs).toBe(0)
  })
})
