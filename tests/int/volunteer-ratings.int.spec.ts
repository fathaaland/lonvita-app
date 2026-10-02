// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as getVolunteer } from '@/app/api/volunteers/[userId]/route'
import { GET as getPool } from '@/app/api/admin/volunteers/route'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

describe("Rating volunteers, and the volunteer's card (VolunteerRatings, GET /api/volunteers/:id)", () => {
  let muni: { id: number }
  let cat: { id: number }
  let pub: TestUser
  let club: TestUser
  let volunteer: TestUser
  let resident: TestUser
  let volunteerProfileId: number
  let pastEvent: { id: number }
  let volunteerRegistration: { id: number }
  const eventIds: number[] = []

  const tokenOf = async (user: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })).token

  const cardAs = async (viewer: TestUser, of: TestUser = volunteer) =>
    getVolunteer(
      new Request(`http://localhost/api/volunteers/${of.id}`, { headers: { Authorization: `JWT ${await tokenOf(viewer)}` } }),
      { params: Promise.resolve({ userId: String(of.id) }) },
    )

  const rate = (user: TestUser, rating: number, comment?: string, registration = volunteerRegistration.id) =>
    payload.create({
      collection: 'volunteer-ratings',
      data: { registration, rating, comment } as never,
      user,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Rating Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Rating ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, role: 'organizer' | 'participant', profile: Record<string, unknown> = {}) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `vrat-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      const created = await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `vrat ${name}`, municipality: muni.id, notifyEmail: false, ...profile },
        overrideAccess: true,
      })
      await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
      return { user, profileId: created.id }
    }
    pub = (await makeUser('hospoda', 'organizer')).user
    club = (await makeUser('spolek', 'organizer')).user
    resident = (await makeUser('resident', 'participant')).user
    const v = await makeUser('dobrovolnik', 'participant', {
      isVolunteer: true,
      volunteerMunicipality: muni.id,
      volunteerFocus: ['akce'],
      volunteerAllowEmail: true,
      volunteerContactEmail: `vrat-contact-${STAMP}@test.local`,
    })
    volunteer = v.user
    volunteerProfileId = v.profileId

    // An event that already happened, with the volunteer on it and marked as attended — set up as
    // trusted writes, since neither a past start nor attendance can be created through the app.
    pastEvent = await payload.db.create({
      collection: 'events',
      data: {
        title: `Rated Event ${STAMP}`,
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
        coOrganizations: [],
        coOrganizers: [],
      },
    })
    eventIds.push(pastEvent.id)
    volunteerRegistration = await payload.create({
      collection: 'registrations',
      data: { event: pastEvent.id, user: volunteer.id, role: 'volunteer', status: 'approved', attendanceStatus: 'not_marked' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
  })

  afterAll(async () => {
    const userIds = [pub.id, club.id, volunteer.id, resident.id]
    await payload.delete({ collection: 'volunteer-ratings', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
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

  it('a volunteer is rated only once marked as attended', async () => {
    await expect(rate(pub, 5)).rejects.toThrow(/docházce/)
    await payload.update({
      collection: 'registrations',
      id: volunteerRegistration.id,
      data: { attendanceStatus: 'attended' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
  })

  it("only the event's organizer rates them, once", async () => {
    await expect(rate(club, 2)).rejects.toThrow(/pořadatel/)
    await expect(rate(resident, 1)).rejects.toThrow()

    const rating = await rate(pub, 5, 'Skvělý řidič, spolehlivý.')
    expect(rating).toMatchObject({ rating: 5, comment: 'Skvělý řidič, spolehlivý.' })
    await expect(rate(pub, 4)).rejects.toThrow(/už/)

    // …and may change their mind.
    const changed = await payload.update({
      collection: 'volunteer-ratings',
      id: rating.id,
      data: { rating: 4 },
      user: pub,
      overrideAccess: false,
    })
    expect(changed.rating).toBe(4)
    await expect(
      payload.update({ collection: 'volunteer-ratings', id: rating.id, data: { rating: 1 }, user: club, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('the average shows in the pool and on the card, with the comment and the event', async () => {
    const pool = await getPool(
      new Request('http://localhost/api/admin/volunteers', { headers: { Authorization: `JWT ${await tokenOf(club)}` } }),
    )
    const rows = ((await pool.json()) as { docs: { user_id: string; rating: { average: number; count: number } | null }[] }).docs
    expect(rows.find((r) => r.user_id === String(volunteer.id))?.rating).toEqual({ average: 4, count: 1 })

    const response = await cardAs(club)
    expect(response.status).toBe(200)
    const card = (await response.json()) as {
      is_self: boolean
      volunteer: { rating: { average: number } }
      ratings: { rating: number; comment: string; event_title: string }[]
      events: { id: string; attended: boolean }[]
    }
    expect(card.is_self).toBe(false)
    expect(card.volunteer.rating.average).toBe(4)
    expect(card.ratings[0]).toMatchObject({ rating: 4, comment: 'Skvělý řidič, spolehlivý.', event_title: `Rated Event ${STAMP}` })
    expect(card.events).toEqual([expect.objectContaining({ id: String(pastEvent.id), attended: true })])
  })

  it('the volunteer sees their own card; someone who organizes nowhere sees no one else’s', async () => {
    const own = await cardAs(volunteer)
    expect(own.status).toBe(200)
    expect(((await own.json()) as { is_self: boolean }).is_self).toBe(true)
    expect((await cardAs(resident)).status).toBe(403)
  })

  it('leaving the pool hides the card; coming back brings it — ratings included', async () => {
    await payload.update({
      collection: 'profiles',
      id: volunteerProfileId,
      data: { isVolunteer: false },
      user: volunteer,
      overrideAccess: false,
    })
    expect((await cardAs(club)).status).toBe(404)
    expect((await cardAs(volunteer)).status).toBe(404)

    await payload.update({
      collection: 'profiles',
      id: volunteerProfileId,
      data: { isVolunteer: true },
      user: volunteer,
      overrideAccess: false,
    })
    const back = (await (await cardAs(club)).json()) as { volunteer: { rating: { count: number } } }
    expect(back.volunteer.rating.count).toBe(1)
  })
})
