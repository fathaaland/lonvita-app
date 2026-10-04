// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

const relId = (value: number | { id: number }) => (typeof value === 'object' ? value.id : value)

describe('Inviting a volunteer from the pool to help on an event (VolunteerInvitations)', () => {
  let muni: { id: number }
  let cat: { id: number }
  let pub: TestUser
  let club: TestUser
  let volunteer: TestUser
  let outsider: TestUser
  let volunteerProfileId: number
  const eventIds: number[] = []

  const createEvent = async (organizer: TestUser, capacity = 10, daysFromNow = 7) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Volunteer Event ${STAMP}`,
        dateTime: new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity,
        organizer: organizer.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'auto',
      },
      user: organizer,
      overrideAccess: false,
    })
    eventIds.push(event.id)
    return event
  }

  const invite = (eventId: number, user: TestUser, volunteerId = volunteer.id, message?: string) =>
    payload.create({
      collection: 'volunteer-invitations',
      data: { event: eventId, volunteer: volunteerId, message } as never,
      user,
      overrideAccess: false,
    })

  const decide = (id: number, status: 'accepted' | 'declined' | 'withdrawn', user: TestUser) =>
    payload.update({ collection: 'volunteer-invitations', id, data: { status }, user, overrideAccess: false })

  const registrationsOf = (eventId: number, user: TestUser) =>
    payload.find({
      collection: 'registrations',
      where: { and: [{ event: { equals: eventId } }, { user: { equals: user.id } }] },
      depth: 0,
      overrideAccess: true,
    })

  const setInPool = (isVolunteer: boolean) =>
    payload.update({
      collection: 'profiles',
      id: volunteerProfileId,
      data: { isVolunteer },
      user: volunteer,
      overrideAccess: false,
    })

  /** sendNotification is fire-and-forget — give it a moment to land. */
  const notificationsFor = async (user: TestUser, title: string) => {
    for (let i = 0; i < 20; i++) {
      const found = await payload.count({
        collection: 'notifications',
        where: { and: [{ user: { equals: user.id } }, { title: { equals: title } }] },
        overrideAccess: true,
      })
      if (found.totalDocs > 0) return found.totalDocs
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return 0
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Volunteer Inv Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Volunteer Inv ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, role: 'organizer' | 'participant', profile: Record<string, unknown> = {}) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `vinv-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      const created = await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `vinv ${name}`, municipality: muni.id, notifyEmail: false, ...profile },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: muni.id, role },
        overrideAccess: true,
      })
      return { user, profileId: created.id }
    }
    pub = (await makeUser('hospoda', 'organizer')).user
    club = (await makeUser('spolek', 'organizer')).user
    outsider = (await makeUser('nedobrovolnik', 'participant')).user
    const v = await makeUser('dobrovolnik', 'participant', {
      isVolunteer: true,
      volunteerMunicipality: muni.id,
      volunteerFocus: ['doprava'],
      volunteerAllowPhone: true,
      volunteerContactPhone: '+420 600 000 003',
    })
    volunteer = v.user
    volunteerProfileId = v.profileId
  })

  afterAll(async () => {
    const userIds = [pub.id, club.id, volunteer.id, outsider.id]
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
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

  it('accepting makes them a volunteer on the event — approved, and not using up a spot', async () => {
    const event = await createEvent(pub, 1)
    const invitation = await invite(event.id, pub, volunteer.id, 'Potřebujeme řidiče.')
    expect(invitation.status).toBe('pending')
    expect(relId(invitation.invitedBy)).toBe(pub.id)
    expect(await notificationsFor(volunteer, 'Pozvánka k dobrovolnické pomoci')).toBeGreaterThan(0)

    // Only the volunteer answers.
    await expect(decide(invitation.id, 'accepted', pub)).rejects.toThrow()
    const accepted = await decide(invitation.id, 'accepted', volunteer)
    expect(accepted.registration).toBeTruthy()

    const regs = await registrationsOf(event.id, volunteer)
    expect(regs.docs).toHaveLength(1)
    expect(regs.docs[0]).toMatchObject({ role: 'volunteer', status: 'approved' })
    expect(await notificationsFor(pub, 'Dobrovolník přijal pozvánku')).toBeGreaterThan(0)

    // The one participant spot is still free.
    const participant = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: outsider.id },
      user: outsider,
      overrideAccess: false,
    })
    expect(participant.status).toBe('approved')
    const fresh = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect(fresh.status).toBe('full')

    // A decision is final.
    await expect(decide(invitation.id, 'declined', volunteer)).rejects.toThrow()
  })

  it('declining leaves the event alone', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, pub)
    await decide(invitation.id, 'declined', volunteer)
    expect((await registrationsOf(event.id, volunteer)).totalDocs).toBe(0)
    expect(await notificationsFor(pub, 'Dobrovolník pozvánku odmítl')).toBeGreaterThan(0)
  })

  it('only the event creator invites, only people in the pool, once', async () => {
    const event = await createEvent(pub)
    await expect(invite(event.id, club)).rejects.toThrow(/založil/)
    await expect(invite(event.id, pub, outsider.id)).rejects.toThrow(/poolu/)
    await expect(invite(event.id, pub, pub.id)).rejects.toThrow()
    await invite(event.id, pub)
    await expect(invite(event.id, pub)).rejects.toThrow(/čeká/)
  })

  it('nobody makes themselves a volunteer — the role comes only from an invitation', async () => {
    const event = await createEvent(pub)
    const registration = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: volunteer.id, role: 'volunteer' },
      user: volunteer,
      overrideAccess: false,
    })
    expect(registration.role).toBe('participant')
  })

  it('a volunteer can only decide, not withdraw', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, pub)
    await expect(decide(invitation.id, 'withdrawn', volunteer)).rejects.toThrow()
  })

  it('leaving the pool withdraws pending invitations; on a free event the volunteer stays as a participant', async () => {
    const helping = await createEvent(pub)
    const helpingInvitation = await invite(helping.id, pub)
    await decide(helpingInvitation.id, 'accepted', volunteer)
    const pendingEvent = await createEvent(club)
    const pending = await invite(pendingEvent.id, club)

    await setInPool(false)

    const withdrawn = await payload.findByID({ collection: 'volunteer-invitations', id: pending.id, overrideAccess: true })
    expect(withdrawn.status).toBe('withdrawn')
    expect(await notificationsFor(club, 'Pozvánka dobrovolníka zrušena')).toBeGreaterThan(0)
    expect(await notificationsFor(pub, 'Dobrovolník odešel z poolu')).toBeGreaterThan(0)
    const regs = await registrationsOf(helping.id, volunteer)
    expect(regs.docs[0]).toMatchObject({ role: 'participant', status: 'approved' })

    // Out of the pool, nobody can invite them.
    await expect(invite((await createEvent(pub)).id, pub)).rejects.toThrow(/poolu/)
    await setInPool(true)
  })

  it('leaving the pool takes a volunteer off a full event — they never had a place', async () => {
    const full = await createEvent(pub, 1)
    const invitation = await invite(full.id, pub)
    await decide(invitation.id, 'accepted', volunteer)
    await payload.create({
      collection: 'registrations',
      data: { event: full.id, user: outsider.id },
      user: outsider,
      overrideAccess: false,
    })

    await setInPool(false)

    const regs = await registrationsOf(full.id, volunteer)
    expect(regs.docs[0]).toMatchObject({ role: 'volunteer', status: 'cancelled' })
    const fresh = await payload.findByID({ collection: 'events', id: full.id, depth: 0, overrideAccess: true })
    expect(fresh.status).toBe('full')
    await setInPool(true)
  })
})
