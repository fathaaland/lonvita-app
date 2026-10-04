// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

const relId = (value: number | { id: number }) => (typeof value === 'object' ? value.id : value)

describe('Co-organizing between organizations takes the invited one’s consent', () => {
  let muni: { id: number }
  let otherMuni: { id: number }
  let cat: { id: number }
  let pub: TestUser
  let club: TestUser
  let bakery: TestUser
  let outsider: TestUser
  let resident: TestUser
  const eventIds: number[] = []
  const orgIdOf = new Map<number, number>()
  const orgOf = (user: TestUser) => orgIdOf.get(user.id)!
  let outsiderOrgId: number

  const createEvent = async (organizer: TestUser) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Invitation Event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        cancellationPolicy: 'none',
      },
      user: organizer,
      overrideAccess: false,
    })
    eventIds.push(event.id)
    return event
  }

  const invite = (eventId: number, organization: number, user: TestUser) =>
    payload.create({
      collection: 'co-organizing-requests',
      data: { event: eventId, organization } as never,
      user,
      overrideAccess: false,
    })

  const decide = (id: number, status: 'approved' | 'rejected', user: TestUser) =>
    payload.update({ collection: 'co-organizing-requests', id, data: { status }, user, overrideAccess: false })

  const coOrganizationsOf = async (eventId: number) =>
    ((await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })).coOrganizations ?? []).map(
      relId,
    )

  const editAs = (eventId: number, user: TestUser, title: string) =>
    payload.update({ collection: 'events', id: eventId, data: { title }, user, overrideAccess: false })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Invitation Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    otherMuni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Invitation Other ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Invitation ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, municipality: { id: number }, role: 'organizer' | 'participant') => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `invitation-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `invitation ${name}`, municipality: municipality.id, notifyEmail: false },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: municipality.id, role },
        overrideAccess: true,
      })
      return user
    }
    pub = await makeUser('hospoda', muni, 'organizer')
    club = await makeUser('spolek', muni, 'organizer')
    bakery = await makeUser('pekarna', muni, 'organizer')
    outsider = await makeUser('cizinec', otherMuni, 'organizer')
    resident = await makeUser('resident', muni, 'participant')

    // The organizer role brings its organization along (UserRoles → ensureOrganization).
    const orgs = await payload.find({
      collection: 'organizations',
      where: { municipality: { in: [muni.id, otherMuni.id] } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    for (const o of orgs.docs) {
      if (o.type === 'municipality') continue
      if (relId(o.municipality) === otherMuni.id) outsiderOrgId = o.id
      else orgIdOf.set(relId(o.owner!), o.id)
    }
  })

  afterAll(async () => {
    const userIds = [pub.id, club.id, bakery.id, outsider.id, resident.id]
    await payload.delete({ collection: 'co-organizing-requests', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    for (const m of [muni, otherMuni]) {
      await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
    }
  })

  it('a pořadatel can’t put another organization on the event directly', async () => {
    const event = await createEvent(pub)
    await expect(
      payload.update({
        collection: 'events',
        id: event.id,
        data: { coOrganizations: [orgOf(club)] },
        user: pub,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/pozvánku/)
    expect(await coOrganizationsOf(event.id)).toEqual([])
  })

  it('the invited organization joins once its owner accepts — and then has equal rights', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, orgOf(club), pub)
    expect(invitation.status).toBe('pending')
    expect(relId(invitation.organizationOwner!)).toBe(club.id)
    expect(invitation.organizationName).toBeTruthy()

    // Not on it yet — so not theirs to edit.
    expect(await coOrganizationsOf(event.id)).toEqual([])
    await expect(editAs(event.id, club, 'Předčasně')).rejects.toThrow()

    // Only the invited organization's owner answers.
    await expect(decide(invitation.id, 'approved', pub)).rejects.toThrow()
    await expect(decide(invitation.id, 'approved', bakery)).rejects.toThrow()
    await expect(decide(invitation.id, 'approved', resident)).rejects.toThrow()

    const accepted = await decide(invitation.id, 'approved', club)
    expect(relId(accepted.reviewedBy!)).toBe(club.id)
    const after = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect((after.coOrganizations ?? []).map(relId)).toEqual([orgOf(club)])
    expect((after.coOrganizers ?? []).map(relId)).toEqual([club.id])

    // Equal rights: the spolupořadatel edits and invites the next one just like the pořadatel.
    expect((await editAs(event.id, club, 'Upraveno spolkem')).title).toBe('Upraveno spolkem')
    const next = await invite(event.id, orgOf(bakery), club)
    await decide(next.id, 'approved', bakery)
    expect((await coOrganizationsOf(event.id)).sort()).toEqual([orgOf(club), orgOf(bakery)].sort())
    expect((await editAs(event.id, bakery, 'Upraveno pekárnou')).title).toBe('Upraveno pekárnou')
  })

  it('a declined invitation leaves the event alone, and a decision is final', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, orgOf(club), pub)
    // One open invitation per organization and event.
    await expect(invite(event.id, orgOf(club), pub)).rejects.toThrow(/už čeká/)

    await decide(invitation.id, 'rejected', club)
    await expect(decide(invitation.id, 'approved', club)).rejects.toThrow()
    expect(await coOrganizationsOf(event.id)).toEqual([])
    // …and they may be invited again.
    await expect(invite(event.id, orgOf(club), pub)).resolves.toBeTruthy()
  })

  it('only someone who may edit the event invites, and only an organization of its obec', async () => {
    const event = await createEvent(pub)
    await expect(invite(event.id, orgOf(bakery), club)).rejects.toThrow()
    await expect(invite(event.id, orgOf(bakery), resident)).rejects.toThrow()
    await expect(invite(event.id, outsiderOrgId, pub)).rejects.toThrow(/z téhle obce/)
    await expect(invite(event.id, orgOf(pub), pub)).rejects.toThrow(/akci už pořádá/)
  })

  it('an invitation to an event cancelled meanwhile can only be declined', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, orgOf(club), pub)
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
      overrideAccess: true,
    })
    await expect(decide(invitation.id, 'approved', club)).rejects.toThrow(/zrušena/)
    await expect(decide(invitation.id, 'rejected', club)).resolves.toBeTruthy()
  })

  it('the invited owner is told, and outsiders don’t see the invitation', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, orgOf(bakery), pub)

    // Fire-and-forget — give it a moment to land.
    let notified = 0
    for (let i = 0; i < 20 && notified === 0; i++) {
      notified = (
        await payload.count({
          collection: 'notifications',
          where: { and: [{ user: { equals: bakery.id } }, { link: { equals: '/organizace' } }] },
          overrideAccess: true,
        })
      ).totalDocs
      if (notified === 0) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(notified).toBeGreaterThan(0)

    const seenBy = async (user: TestUser) =>
      (
        await payload.find({
          collection: 'co-organizing-requests',
          where: { id: { equals: invitation.id } },
          user,
          overrideAccess: false,
        })
      ).totalDocs
    expect(await seenBy(bakery)).toBe(1)
    expect(await seenBy(pub)).toBe(1)
    expect(await seenBy(club)).toBe(0)
  })

  const lapse = (id: number) =>
    payload.update({
      collection: 'co-organizing-requests',
      id,
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    })

  it('an invitation lapses after 24 hours — never past the event’s start', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, orgOf(club), pub)
    const hours = (new Date(invitation.expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThanOrEqual(24)

    const soon = await createEvent(pub)
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await payload.update({ collection: 'events', id: soon.id, data: { dateTime: startsAt }, overrideAccess: true })
    const capped = await invite(soon.id, orgOf(club), pub)
    expect(new Date(capped.expiresAt).getTime()).toBe(new Date(startsAt).getTime())
  })

  it('of two invited, the one who doesn’t accept in time isn’t on the event', async () => {
    const event = await createEvent(pub)
    const toClub = await invite(event.id, orgOf(club), pub)
    const toBakery = await invite(event.id, orgOf(bakery), pub)
    await decide(toClub.id, 'approved', club)
    await lapse(toBakery.id)

    const lapsed = await payload.findByID({ collection: 'co-organizing-requests', id: toBakery.id, overrideAccess: true })
    expect(lapsed.status).toBe('expired')
    await expect(decide(toBakery.id, 'approved', bakery)).rejects.toThrow(/vypršela/)
    // The event goes on with the pořadatel and the one spolupořadatel who accepted.
    expect(await coOrganizationsOf(event.id)).toEqual([orgOf(club)])

    // A lapsed invitation doesn't block a new one.
    const again = await invite(event.id, orgOf(bakery), pub)
    expect(again.status).toBe('pending')
  })

  it('deleting an invited organization takes its invitations along', async () => {
    const event = await createEvent(pub)
    const invitation = await invite(event.id, orgOf(bakery), pub)
    await payload.delete({ collection: 'organizations', id: orgOf(bakery), overrideAccess: true })
    const left = await payload.find({
      collection: 'co-organizing-requests',
      where: { id: { equals: invitation.id } },
      overrideAccess: true,
    })
    expect(left.totalDocs).toBe(0)
  })
})
