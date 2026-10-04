// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { POST as decide } from '@/app/api/events/deletion-requests/[id]/decide/route'
import { POST as escalate } from '@/app/api/events/deletion-requests/[id]/escalate/route'
import { POST as municipalityDecide } from '@/app/api/events/deletion-requests/[id]/municipality-decide/route'
import { POST as obecLeave } from '@/app/api/events/[id]/obec-leave/route'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

describe('Co-organized events: who edits, and deleting only with consent', () => {
  let muni: { id: number }
  let cat: { id: number }
  let admin: TestUser
  let pub: TestUser
  let club: TestUser
  let bakery: TestUser
  let resident: TestUser
  const eventIds: number[] = []
  const orgIdOf = new Map<number, number>()
  const orgOf = (user: TestUser) => orgIdOf.get(user.id)!
  let obecOrgId: number
  const relId = (value: number | { id: number }) => (typeof value === 'object' ? value.id : value)

  const createEvent = async (organizer: TestUser, coOrganizers: TestUser[]) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Consent Event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        coOrganizations: coOrganizers.map(orgOf),
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      // Set up as a trusted write: co-organizers otherwise join only by accepting an invitation
      // (co-organizing-invitations.int.spec.ts covers that).
      overrideAccess: true,
    })
    eventIds.push(event.id)
    return event
  }

  const requestDeletion = (eventId: number, user: TestUser) =>
    payload.create({
      collection: 'event-deletion-requests',
      // Everything but the event is derived server-side.
      data: { event: eventId } as never,
      user,
      overrideAccess: false,
    })

  const postAs = async (
    route: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
    action: string,
    user: TestUser,
    requestId: number,
    body: unknown,
  ) => {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
    return route(
      new Request(`http://localhost/api/events/deletion-requests/${requestId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: String(requestId) }) },
    )
  }
  const decideAs = (user: TestUser, requestId: number, decision: 'approve' | 'reject' | 'remove-requester') =>
    postAs(decide, 'decide', user, requestId, { decision })
  const escalateAs = (user: TestUser, requestId: number) => postAs(escalate, 'escalate', user, requestId, {})
  const obecDecides = (user: TestUser, requestId: number, remove: boolean) =>
    postAs(municipalityDecide, 'municipality-decide', user, requestId, { remove })

  const eventExists = async (id: number) =>
    Boolean(await payload.findByID({ collection: 'events', id, overrideAccess: true }).catch(() => null))

  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Consent Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Consent ${STAMP}` },
      overrideAccess: true,
    })

    const makeUser = async (name: string, role: string) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `consent-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `consent ${name}`, municipality: muni.id, notifyEmail: false },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: muni.id, role: role as 'organizer' },
        overrideAccess: true,
      })
      return user
    }
    admin = await makeUser('admin', 'municipality_admin')
    pub = await makeUser('hospoda', 'organizer')
    club = await makeUser('spolek', 'organizer')
    bakery = await makeUser('pekarna', 'organizer')
    resident = await makeUser('resident', 'participant')

    // The organizer role brings its organization along (UserRoles → ensureOrganization).
    const orgs = await payload.find({
      collection: 'organizations',
      where: { municipality: { equals: muni.id } },
      depth: 0,
      overrideAccess: true,
    })
    for (const o of orgs.docs) {
      if (o.type === 'municipality') obecOrgId = o.id
      else orgIdOf.set(relId(o.owner!), o.id)
    }
  })

  afterAll(async () => {
    const userIds = [admin.id, pub.id, club.id, bakery.id, resident.id]
    await payload.delete({ collection: 'event-deletion-requests', where: { requestedBy: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'co-organizing-requests', where: { requestedBy: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  it('the obec founds an event with the pub as co-organizer — the pub helps, only the obec edits', async () => {
    const event = await createEvent(admin, [pub])
    expect(relId(event.organization!)).toBe(obecOrgId)
    expect((event.coOrganizers ?? []).map((u) => (typeof u === 'object' ? u.id : u))).toEqual([pub.id])

    await expect(
      payload.update({ collection: 'events', id: event.id, data: { title: 'Hospoda' }, user: pub, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(requestDeletion(event.id, pub)).rejects.toThrow()

    const edited = await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: 'Obec' },
      user: admin,
      overrideAccess: false,
    })
    expect(edited.title).toBe('Obec')
    const read = await payload.findByID({ collection: 'events', id: event.id, user: pub, overrideAccess: false })
    expect(read.lockedForViewer).toBe(true)
  })

  it('two organizers both edit, but neither can cancel it outright or remove the other', async () => {
    const event = await createEvent(pub, [club, bakery])

    const edited = await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: 'Upraveno spolkem' },
      user: club,
      overrideAccess: false,
    })
    expect(edited.title).toBe('Upraveno spolkem')

    for (const user of [pub, club]) {
      await expect(
        payload.update({
          collection: 'events',
          id: event.id,
          data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
          user,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    }
    // Removing the bakery — not themselves — isn't the club's call.
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { coOrganizations: [orgOf(club)] }, user: club, overrideAccess: false }),
    ).rejects.toThrow()
    // Nor is leaving it themselves — that goes through a deletion request (the others let them go,
    // or the obec decides).
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { coOrganizations: [orgOf(bakery)] }, user: club, overrideAccess: false }),
    ).rejects.toThrow(/žádost o smazání/)
    // The obec's admin takes anyone off directly.
    const removed = await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [orgOf(bakery)] },
      user: admin,
      overrideAccess: false,
    })
    expect((removed.coOrganizers ?? []).map((u) => (typeof u === 'object' ? u.id : u))).toEqual([bakery.id])

    const read = await payload.findByID({ collection: 'events', id: event.id, user: pub, overrideAccess: false })
    expect(read.deletionNeedsConsent).toBe(true)
    expect(read.lockedForViewer).toBe(false)
  })

  it('a refusal keeps the event; a consent hard-deletes it with its registrations', async () => {
    const event = await createEvent(pub, [club])
    await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: resident.id, status: 'approved' },
      overrideAccess: true,
    })

    const first = await requestDeletion(event.id, club)
    expect((first.approvers ?? []).map((a) => (typeof a === 'object' ? a.id : a))).toEqual([pub.id])
    expect(typeof first.requestedBy === 'object' ? first.requestedBy.id : first.requestedBy).toBe(club.id)
    // One open request per event.
    await expect(requestDeletion(event.id, pub)).rejects.toThrow()

    // Not the requester's (or a stranger's) call.
    expect((await decideAs(club, first.id, 'approve')).status).toBe(403)
    expect((await decideAs(resident, first.id, 'approve')).status).toBe(403)

    const refused = await decideAs(pub, first.id, 'reject')
    expect(await refused.json()).toEqual({ status: 'rejected' })
    expect(await eventExists(event.id)).toBe(true)

    const second = await requestDeletion(event.id, club)
    const approved = await decideAs(pub, second.id, 'approve')
    expect(await approved.json()).toEqual({ status: 'approved' })

    expect(await eventExists(event.id)).toBe(false)
    const regs = await payload.find({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true })
    expect(regs.totalDocs).toBe(0)
    const history = await payload.findByID({ collection: 'event-deletion-requests', id: second.id, overrideAccess: true })
    expect(history.status).toBe('approved')
    expect(history.eventTitle).toBe(`Consent Event ${STAMP}`)
  })

  it('with three organizers every one of the others has to consent', async () => {
    const event = await createEvent(pub, [club, bakery])
    const request = await requestDeletion(event.id, club)

    expect(await (await decideAs(pub, request.id, 'approve')).json()).toEqual({ status: 'pending' })
    expect(await eventExists(event.id)).toBe(true)
    expect(await (await decideAs(bakery, request.id, 'approve')).json()).toEqual({ status: 'approved' })
    expect(await eventExists(event.id)).toBe(false)
  })

  it('an unanswered request lapses after its 24 hours and the event stays', async () => {
    const event = await createEvent(pub, [club])
    const request = await requestDeletion(event.id, club)
    const hours = (new Date(request.expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThanOrEqual(24)

    await payload.update({
      collection: 'event-deletion-requests',
      id: request.id,
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    })

    const late = await decideAs(pub, request.id, 'approve')
    expect(late.status).toBe(409)
    expect(await eventExists(event.id)).toBe(true)
    // …and a fresh request can be made.
    await expect(requestDeletion(event.id, club)).resolves.toBeTruthy()
  })

  it('a sole organizer just cancels — and the obec admin always can', async () => {
    const solo = await createEvent(bakery, [])
    await expect(requestDeletion(solo.id, bakery)).rejects.toThrow()

    const shared = await createEvent(pub, [club])
    const cancelled = await payload.update({
      collection: 'events',
      id: shared.id,
      data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
      user: admin,
      overrideAccess: false,
    })
    expect(cancelled.deletedAt).toBeTruthy()
  })

  const readEvent = (id: number) => payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true })
  const readRequest = (id: number) =>
    payload.findByID({ collection: 'event-deletion-requests', id, depth: 0, overrideAccess: true })
  const ids = (values?: (number | { id: number })[] | null) => (values ?? []).map(relId)

  it('a spolupořadatel asks — the other keeps the event and lets them go', async () => {
    const event = await createEvent(pub, [club])
    const request = await requestDeletion(event.id, club)
    // Not the requester's call.
    expect((await decideAs(club, request.id, 'remove-requester')).status).toBe(403)

    expect(await (await decideAs(pub, request.id, 'remove-requester')).json()).toEqual({ status: 'requester-removed' })
    const after = await readEvent(event.id)
    expect(relId(after.organizer)).toBe(pub.id)
    expect(ids(after.coOrganizations)).toEqual([])
    expect(ids(after.coOrganizers)).toEqual([])
    const settled = await readRequest(request.id)
    expect(settled.status).toBe('requester-removed')
    expect(settled.successor ?? null).toBeNull()

    // The pub runs it alone now — it cancels outright.
    const read = await payload.findByID({ collection: 'events', id: event.id, user: pub, overrideAccess: false })
    expect(read.deletionNeedsConsent).toBe(false)
  })

  it('the pořadatel asks — a spolupořadatel takes the event over, creator rights included', async () => {
    const event = await createEvent(pub, [club])
    const request = await requestDeletion(event.id, pub)

    expect(await (await decideAs(club, request.id, 'remove-requester')).json()).toEqual({ status: 'requester-removed' })
    const after = await readEvent(event.id)
    expect(relId(after.organizer)).toBe(club.id)
    expect(relId(after.organization!)).toBe(orgOf(club))
    expect(ids(after.coOrganizations)).toEqual([])
    expect(ids(after.coOrganizers)).toEqual([])
    expect(relId((await readRequest(request.id)).successor!)).toBe(club.id)

    // The volunteering flag is the creator's — the club's now.
    const flagged = await payload.update({
      collection: 'events',
      id: event.id,
      data: { isVolunteering: true },
      user: club,
      overrideAccess: false,
    })
    expect(flagged.isVolunteering).toBe(true)
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { title: 'Pořád moje' }, user: pub, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('with three organizers the first one keeping the event settles the request', async () => {
    const event = await createEvent(pub, [club, bakery])
    const request = await requestDeletion(event.id, club)
    expect(await (await decideAs(pub, request.id, 'approve')).json()).toEqual({ status: 'pending' })
    expect(await (await decideAs(bakery, request.id, 'remove-requester')).json()).toEqual({
      status: 'requester-removed',
    })

    const after = await readEvent(event.id)
    expect(relId(after.organizer)).toBe(pub.id)
    expect(ids(after.coOrganizers)).toEqual([bakery.id])
    expect((await decideAs(pub, request.id, 'reject')).status).toBe(409)
  })

  it('after a refusal the requester turns to the obec, which takes them off without consent', async () => {
    const event = await createEvent(pub, [club])
    const request = await requestDeletion(event.id, pub)
    // Only once a spolupořadatel refused.
    expect((await escalateAs(pub, request.id)).status).toBe(409)
    expect(await (await decideAs(club, request.id, 'reject')).json()).toEqual({ status: 'rejected' })
    expect(relId((await readRequest(request.id)).rejectedBy!)).toBe(club.id)

    // Only the requester escalates.
    expect((await escalateAs(club, request.id)).status).toBe(403)
    expect(await (await escalateAs(pub, request.id)).json()).toEqual({ status: 'escalated' })
    const escalated = await readRequest(request.id)
    expect(escalated.status).toBe('escalated')
    expect(new Date(escalated.expiresAt).getTime()).toBe(new Date(event.dateTime).getTime())
    // While the obec decides, nobody opens another request.
    await expect(requestDeletion(event.id, club)).rejects.toThrow(/už se rozhoduje/)

    // Only the obec decides.
    expect((await obecDecides(club, request.id, true)).status).toBe(403)
    expect((await obecDecides(pub, request.id, true)).status).toBe(403)
    expect(await (await obecDecides(admin, request.id, true)).json()).toEqual({ status: 'requester-removed' })

    // The pořadatel left — the event passed to the club that refused.
    const after = await readEvent(event.id)
    expect(relId(after.organizer)).toBe(club.id)
    expect(relId(after.organization!)).toBe(orgOf(club))
    expect(ids(after.coOrganizers)).toEqual([])
    const settled = await readRequest(request.id)
    expect(settled.status).toBe('requester-removed')
    expect(relId(settled.successor!)).toBe(club.id)
    expect(relId(settled.decidedBy!)).toBe(admin.id)
  })

  it('the obec may turn it down, and an escalation lapses once the event starts', async () => {
    const event = await createEvent(pub, [club])
    const first = await requestDeletion(event.id, club)
    await decideAs(pub, first.id, 'reject')
    await escalateAs(club, first.id)

    expect(await (await obecDecides(admin, first.id, false)).json()).toEqual({ status: 'escalation-rejected' })
    expect(ids((await readEvent(event.id)).coOrganizers)).toEqual([club.id])
    // Decided once and for all.
    expect((await obecDecides(admin, first.id, true)).status).toBe(409)
    expect((await escalateAs(club, first.id)).status).toBe(409)

    const second = await requestDeletion(event.id, club)
    await decideAs(pub, second.id, 'reject')
    await escalateAs(club, second.id)
    await payload.update({
      collection: 'event-deletion-requests',
      id: second.id,
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    })
    expect((await readRequest(second.id)).status).toBe('expired')
    expect((await obecDecides(admin, second.id, true)).status).toBe(409)
    expect(ids((await readEvent(event.id)).coOrganizers)).toEqual([club.id])
  })

  const invite = (eventId: number, organization: number, user: TestUser) =>
    payload.create({
      collection: 'co-organizing-requests',
      data: { event: eventId, organization } as never,
      user,
      overrideAccess: false,
    })

  const decideInvitation = (id: number, status: 'approved' | 'rejected', user: TestUser) =>
    payload.update({ collection: 'co-organizing-requests', id, data: { status }, user, overrideAccess: false })

  /** The obec never puts itself on an event — its pořadatel invites it, and its admin accepts. */
  const obecJoins = async (event: { id: number }, inviter: TestUser) => {
    const invitation = await invite(event.id, obecOrgId, inviter)
    expect(invitation.status).toBe('pending')
    await decideInvitation(invitation.id, 'approved', admin)
  }

  const obecLeaves = async (user: TestUser, eventId: number) => {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
    return obecLeave(
      new Request(`http://localhost/api/events/${eventId}/obec-leave`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}` },
      }),
      { params: Promise.resolve({ id: String(eventId) }) },
    )
  }

  it("a pořadatel invites the obec — once it accepts, only the obec edits the event", async () => {
    const event = await createEvent(pub, [club])
    await expect(
      payload.update({
        collection: 'events',
        id: event.id,
        data: { coOrganizations: [orgOf(club), obecOrgId] },
        user: pub,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/pozvánku/)
    // Only someone who may edit the event invites.
    await expect(invite(event.id, obecOrgId, resident)).rejects.toThrow()

    const request = await invite(event.id, obecOrgId, club)
    expect(request.status).toBe('pending')
    await expect(invite(event.id, obecOrgId, pub)).rejects.toThrow(/už čeká/)
    // Not the pořadatel's call.
    await expect(decideInvitation(request.id, 'approved', pub)).rejects.toThrow()

    const approved = await decideInvitation(request.id, 'approved', admin)
    expect(relId(approved.reviewedBy!)).toBe(admin.id)
    const after = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect((after.coOrganizations ?? []).map(relId).sort()).toEqual([orgOf(club), obecOrgId].sort())
    // The obec's organization has no person behind it — the co-organizing users stay the same.
    expect((after.coOrganizers ?? []).map(relId)).toEqual([club.id])
    // A decision is final, and the obec is already on.
    await expect(decideInvitation(request.id, 'rejected', admin)).rejects.toThrow()
    await expect(invite(event.id, obecOrgId, admin)).rejects.toThrow(/už akci spolupořádá/)

    // With the obec on it, the pořadatelé help run it but no longer edit it.
    for (const user of [pub, club]) {
      const read = await payload.findByID({ collection: 'events', id: event.id, user, overrideAccess: false })
      expect(read.lockedForViewer).toBe(true)
      await expect(
        payload.update({ collection: 'events', id: event.id, data: { title: 'Bez obce' }, user, overrideAccess: false }),
      ).rejects.toThrow()
    }

    // Once the obec's admin takes the obec off, they're equal again — and the obec is off for good.
    const left = await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [orgOf(club)] },
      user: admin,
      overrideAccess: false,
    })
    expect(left.obecLeftAt).toBeTruthy()
    const edited = await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: 'Hospoda bez obce' },
      user: pub,
      overrideAccess: false,
    })
    expect(edited.title).toBe('Hospoda bez obce')
    await expect(invite(event.id, obecOrgId, pub)).rejects.toThrow(/vrátit/)
  })

  it('a declined invitation leaves the event as it was', async () => {
    const event = await createEvent(bakery, [])
    const request = await invite(event.id, obecOrgId, bakery)
    const rejected = await decideInvitation(request.id, 'rejected', admin)
    expect(rejected.status).toBe('rejected')
    const after = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect(after.coOrganizations ?? []).toEqual([])
    // …and they may invite it again.
    await expect(invite(event.id, obecOrgId, bakery)).resolves.toBeTruthy()
  })

  it("the obec's admin invites a business, which has to accept — but never puts the obec itself on an event", async () => {
    const own = await createEvent(admin, [])
    await expect(
      payload.update({
        collection: 'events',
        id: own.id,
        data: { coOrganizations: [orgOf(bakery)] },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/pozvánku/)
    const invitation = await invite(own.id, orgOf(bakery), admin)
    expect(invitation.status).toBe('pending')
    await decideInvitation(invitation.id, 'approved', bakery)
    const accepted = await payload.findByID({ collection: 'events', id: own.id, depth: 0, overrideAccess: true })
    expect((accepted.coOrganizations ?? []).map(relId)).toEqual([orgOf(bakery)])
    // The obec already runs it — it can't co-organize it too.
    await expect(invite(own.id, obecOrgId, admin)).rejects.toThrow(/pořádá obec sama/)

    const theirs = await createEvent(pub, [])
    await expect(invite(theirs.id, obecOrgId, admin)).rejects.toThrow(/sama nemůže/)
    const untouched = await payload.findByID({ collection: 'events', id: theirs.id, depth: 0, overrideAccess: true })
    expect(untouched.coOrganizations ?? []).toEqual([])
  })

  it('with the obec on it, its organizers can neither cancel it nor ask to', async () => {
    const event = await createEvent(bakery, [])
    await obecJoins(event, bakery)

    const read = await payload.findByID({ collection: 'events', id: event.id, user: bakery, overrideAccess: false })
    expect(read.deletionNeedsConsent).toBe(false)
    await expect(
      payload.update({
        collection: 'events',
        id: event.id,
        data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
        user: bakery,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(requestDeletion(event.id, bakery)).rejects.toThrow(/spolupořádá obec/)
  })

  it("the obec's admin cancels an event the obec co-organizes outright", async () => {
    const event = await createEvent(pub, [])
    await obecJoins(event, pub)
    const cancelled = await payload.update({
      collection: 'events',
      id: event.id,
      data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
      user: admin,
      overrideAccess: false,
    })
    expect(cancelled.deletedAt).toBeTruthy()
  })

  it('the obec steps off an event it co-organizes on its own — and never comes back', async () => {
    const event = await createEvent(pub, [club])
    await obecJoins(event, pub)

    // Only the obec's admin, only while the obec is on it.
    expect((await obecLeaves(pub, event.id)).status).toBe(403)
    expect((await obecLeaves(club, event.id)).status).toBe(403)

    const response = await obecLeaves(admin, event.id)
    expect(response.status).toBe(200)
    const after = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect((after.coOrganizations ?? []).map(relId)).toEqual([orgOf(club)])
    expect(after.obecLeftAt).toBeTruthy()
    expect((await obecLeaves(admin, event.id)).status).toBe(409)

    // The organizers have it back — and hear about it.
    const edited = await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: 'Zase naše' },
      user: pub,
      overrideAccess: false,
    })
    expect(edited.title).toBe('Zase naše')
    const told = await payload.find({
      collection: 'notifications',
      where: { and: [{ user: { equals: pub.id } }, { title: { equals: 'Obec akci už nespolupořádá' } }] },
      overrideAccess: true,
    })
    expect(told.docs).toHaveLength(1)

    // No way back: not invited, not put on as an accepted invitation would.
    await expect(invite(event.id, obecOrgId, pub)).rejects.toThrow(/vrátit/)
    await expect(
      payload.update({
        collection: 'events',
        id: event.id,
        data: { coOrganizations: [orgOf(club), obecOrgId] },
        context: { coOrganizingApproved: true },
        user: admin,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/vrátit/)
  })
})
