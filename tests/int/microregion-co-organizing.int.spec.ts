// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { POST as decide } from '@/app/api/events/deletion-requests/[id]/decide/route'
import { POST as escalate } from '@/app/api/events/deletion-requests/[id]/escalate/route'
import { POST as obecLeave } from '@/app/api/events/[id]/obec-leave/route'
import { POST as leave } from '@/app/api/events/[id]/leave/route'
import { POST as municipalityDecide } from '@/app/api/events/deletion-requests/[id]/municipality-decide/route'
import { GET as candidates } from '@/app/api/events/co-organizer-candidates/route'
import { GET as regionImpact } from '@/app/api/admin/microregions/impact/route'
import { municipalityOrganizationIds } from '@/collections/Organizations'
import { getEventTeamUserIds } from '@/collections/shared/notify'

// A neighbouring obec from the mikroregion co-organizing an event is a spolupořadatel like any
// organization: it accepts the invitation, nobody cancels the event without its consent (but the
// event's own obec), it leaves only through a deletion request — any of its admins answering for
// it — and it never takes the event over. Unlike an organization, it may take an organization off
// the event; an organization can't take it off.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe('Mikroregion: a neighbouring obec co-organizes like an organization', () => {
  let main: { id: number }
  let village: { id: number }
  let category: { id: number }
  let mainAdmin: TestUser
  /** Another admin of the event's obec — not the one who founded its event. */
  let mainAdmin2: TestUser
  let villageAdmin: TestUser
  /** A second admin of the village — any of them answers for it. */
  let villageAdmin2: TestUser
  let pub: TestUser
  let club: TestUser
  let clubOrgId: number
  let villageObecOrg: number
  /** An organizer whose organization is in the village — a neighbour's business on the main obec's events. */
  let villageClub: TestUser
  let villageClubOrgId: number
  /** A third obec of the region with nobody to answer for it. */
  let lonely: { id: number }
  let lonelyObecOrg: number
  let superadmin: TestUser
  let regionId: number
  const users: TestUser[] = []
  const eventIds: number[] = []

  const makeMuni = (name: string) =>
    payload.create({
      collection: 'municipalities',
      data: {
        name: `Coorg ${name} ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })

  const makeUser = async (name: string, municipality: { id: number }) => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `coorg-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as TestUser
    await payload.create({
      collection: 'profiles',
      data: {
        user: user.id,
        fullName: `Coorg ${name}`,
        municipality: municipality.id,
        notifyEmail: false,
      },
      overrideAccess: true,
    })
    users.push(user)
    return user
  }

  const grant = (
    user: TestUser,
    municipality: { id: number },
    role: 'municipality_admin' | 'organizer',
  ) =>
    payload.create({
      collection: 'user-roles',
      data: { user: user.id, municipality: municipality.id, role },
      overrideAccess: true,
    })

  /** The organizer role in an obec comes with the owner's organization there. */
  const makeOrg = async (owner: TestUser) =>
    (
      await payload.find({
        collection: 'organizations',
        where: { and: [{ owner: { equals: owner.id } }, { municipality: { equals: main.id } }] },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]?.id ??
    (
      await payload.create({
        collection: 'organizations',
        data: {
          name: `Coorg org ${owner.id} ${STAMP}`,
          type: 'association',
          owner: owner.id,
          municipality: main.id,
        },
        overrideAccess: true,
      })
    ).id

  const obecOrgOf = async (municipality: { id: number }) =>
    Number(
      (
        await municipalityOrganizationIds({ payload, context: {} } as never, [
          String(municipality.id),
        ])
      ).get(String(municipality.id)),
    )

  const makeEvent = async (by: TestUser, title: string, startsIn = 6 * DAY) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `${title} ${STAMP}`,
        dateTime: new Date(Date.now() + startsIn).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: by.id,
        municipality: main.id,
        categories: [category.id],
        isPaid: false,
        isVolunteering: false,
        registrationApprovalMode: 'auto',
      } as never,
      user: by,
      overrideAccess: false,
    })
    eventIds.push(event.id)
    return event
  }

  /** Invited by `inviter`, accepted by `accepter` — the organization joins once it says yes. */
  const joins = async (
    eventId: number,
    organization: number,
    inviter: TestUser,
    accepter: TestUser,
  ) => {
    const request = await payload.create({
      collection: 'co-organizing-requests',
      data: { event: eventId, organization } as never,
      user: inviter,
      overrideAccess: false,
    })
    expect(request.status).toBe('pending')
    await payload.update({
      collection: 'co-organizing-requests',
      id: request.id,
      data: { status: 'approved' },
      user: accepter,
      overrideAccess: false,
    })
  }

  const cancelAs = (user: TestUser, eventId: number) =>
    payload.update({
      collection: 'events',
      id: eventId,
      data: { status: 'cancelled' },
      user,
      overrideAccess: false,
    })

  const requestDeletion = (eventId: number, user: TestUser) =>
    payload.create({
      collection: 'event-deletion-requests',
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
    const { token } = await payload.login({
      collection: 'users',
      data: { email: user.email, password: 'test1234' },
    })
    return route(
      new Request(`http://localhost/api/events/deletion-requests/${requestId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: String(requestId) }) },
    )
  }
  const decideAs = (
    user: TestUser,
    requestId: number,
    decision: 'approve' | 'reject' | 'remove-requester',
  ) => postAs(decide, 'decide', user, requestId, { decision })

  const coOrganizationsOf = async (eventId: number) =>
    (
      (
        await payload.findByID({
          collection: 'events',
          id: eventId,
          depth: 0,
          overrideAccess: true,
        })
      ).coOrganizations ?? []
    ).map((o) => Number(typeof o === 'object' ? o.id : o))

  const titlesFor = async (user: TestUser) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { user: { equals: user.id } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs.map((n) => n.title)

  beforeAll(async () => {
    payload = await getPayload({ config })
    main = await makeMuni('Main')
    village = await makeMuni('Village')
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Coorg Category ${STAMP}` },
      overrideAccess: true,
    })
    mainAdmin = await makeUser('main-admin', main)
    mainAdmin2 = await makeUser('main-admin-2', main)
    villageAdmin = await makeUser('village-admin', village)
    villageAdmin2 = await makeUser('village-admin-2', village)
    pub = await makeUser('pub', main)
    club = await makeUser('club', main)
    await grant(mainAdmin, main, 'municipality_admin')
    await grant(mainAdmin2, main, 'municipality_admin')
    await grant(villageAdmin, village, 'municipality_admin')
    await grant(villageAdmin2, village, 'municipality_admin')
    await grant(pub, main, 'organizer')
    await grant(club, main, 'organizer')
    await makeOrg(pub)
    clubOrgId = await makeOrg(club)
    villageObecOrg = await obecOrgOf(village)
    villageClub = await makeUser('village-club', village)
    await grant(villageClub, village, 'organizer')
    villageClubOrgId = (
      await payload.find({
        collection: 'organizations',
        where: { and: [{ owner: { equals: villageClub.id } }, { municipality: { equals: village.id } }] },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]!.id
    lonely = await makeMuni('Lonely')
    lonelyObecOrg = await obecOrgOf(lonely)
    superadmin = (await payload.create({
      collection: 'users',
      data: { email: `coorg-superadmin-${STAMP}@test.local`, password: 'test1234', role: 'admin' },
      overrideAccess: true,
    })) as TestUser
    users.push(superadmin)
    regionId = (await payload.create({
      collection: 'microregions',
      data: {
        name: `Coorg region ${STAMP}`,
        municipalities: [main.id, village.id, lonely.id],
        mainMunicipality: main.id,
      },
      overrideAccess: true,
    })).id
  })

  afterAll(async () => {
    const userIds = users.map((u) => u.id)
    const quietly = (p: Promise<unknown>) => p.catch(() => {})
    await quietly(
      payload.delete({
        collection: 'microregions',
        where: { name: { contains: `${STAMP}` } },
        overrideAccess: true,
      }),
    )
    for (const id of eventIds) {
      await quietly(
        payload.delete({
          collection: 'event-deletion-requests',
          where: { event: { equals: id } },
          overrideAccess: true,
        }),
      )
      await quietly(payload.delete({ collection: 'events', id, overrideAccess: true }))
    }
    await quietly(
      payload.delete({
        collection: 'event-deletion-requests',
        where: { requestedBy: { in: userIds } },
        overrideAccess: true,
      }),
    )
    await quietly(
      payload.delete({
        collection: 'notifications',
        where: { user: { in: userIds } },
        overrideAccess: true,
      }),
    )
    await quietly(
      payload.delete({
        collection: 'organizations',
        where: { owner: { in: userIds } },
        overrideAccess: true,
      }),
    )
    await quietly(
      payload.delete({
        collection: 'profiles',
        where: { user: { in: userIds } },
        overrideAccess: true,
      }),
    )
    await quietly(
      payload.delete({
        collection: 'user-roles',
        where: { user: { in: userIds } },
        overrideAccess: true,
      }),
    )
    await quietly(
      payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }),
    )
    await quietly(
      payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }),
    )
    for (const m of [main, village, lonely]) {
      await quietly(
        payload.delete({
          collection: 'organizations',
          where: { municipality: { equals: m.id } },
          overrideAccess: true,
        }),
      )
      await quietly(
        payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }),
      )
    }
  })

  it("the obec's own event: the neighbour can't cancel it alone, the event's obec still can", async () => {
    const event = await makeEvent(mainAdmin, 'Obecní akce')
    await joins(event.id, villageObecOrg, mainAdmin, villageAdmin)
    const joined = await payload.findByID({
      collection: 'events',
      id: event.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(await getEventTeamUserIds(payload, joined)).toEqual(
      expect.arrayContaining([String(villageAdmin.id), String(villageAdmin2.id)]),
    )

    await expect(cancelAs(villageAdmin, event.id)).rejects.toThrow(/jen s jejich souhlasem/)
    const cancelled = await cancelAs(mainAdmin2, event.id)
    expect(cancelled.status).toBe('cancelled')
    // The neighbour hears the obec did it, like any spolupořadatel.
    expect(await titlesFor(villageAdmin2)).toContain('Obec zrušila vaši akci')
  })

  it("an organization's event: neither it nor the neighbour cancels alone; any neighbour admin consents", async () => {
    const event = await makeEvent(pub, 'Akce podniku')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await expect(cancelAs(pub, event.id)).rejects.toThrow(/jen s jejich souhlasem/)
    await expect(cancelAs(villageAdmin, event.id)).rejects.toThrow(/jen s jejich souhlasem/)

    const request = await requestDeletion(event.id, pub)
    expect(
      (request.neighbourMunicipalities ?? []).map((m) => Number(typeof m === 'object' ? m.id : m)),
    ).toEqual([village.id])
    expect(request.approvers ?? []).toEqual([])
    expect(await titlesFor(villageAdmin2)).toContain('Žádost o smazání akce')

    const response = await decideAs(villageAdmin2, request.id, 'approve')
    expect(await response.json()).toEqual({ status: 'approved' })
    expect(
      await payload
        .findByID({ collection: 'events', id: event.id, overrideAccess: true })
        .catch(() => null),
    ).toBeNull()
  })

  it('the neighbour asks to leave; the pořadatel keeps the event and lets it go', async () => {
    const event = await makeEvent(pub, 'Akce bez souseda')
    await joins(event.id, villageObecOrg, pub, villageAdmin)

    const request = await requestDeletion(event.id, villageAdmin)
    expect(
      Number(
        request.requesterMunicipality && typeof request.requesterMunicipality === 'object'
          ? request.requesterMunicipality.id
          : request.requesterMunicipality,
      ),
    ).toBe(village.id)
    expect((request.approvers ?? []).map((a) => Number(typeof a === 'object' ? a.id : a))).toEqual([
      pub.id,
    ])

    const response = await decideAs(pub, request.id, 'remove-requester')
    expect(await response.json()).toEqual({ status: 'requester-removed' })
    expect(await coOrganizationsOf(event.id)).not.toContain(villageObecOrg)
    expect(await titlesFor(villageAdmin2)).toContain('Obec akci už nespolupořádá')
  })

  it('the neighbour refuses — the pořadatel may turn to the obec; the neighbour never takes the event over', async () => {
    const event = await makeEvent(pub, 'Akce se sousedem')
    await joins(event.id, villageObecOrg, pub, villageAdmin)

    const request = await requestDeletion(event.id, pub)
    const takeOver = await decideAs(villageAdmin, request.id, 'remove-requester')
    expect(takeOver.status).toBe(409)

    expect(await (await decideAs(villageAdmin, request.id, 'reject')).json()).toEqual({
      status: 'rejected',
    })
    expect((await postAs(escalate, 'escalate', pub, request.id, {})).status).toBe(200)
  })

  it('the neighbour takes an organization off the event — an organization never takes the neighbour off', async () => {
    const event = await makeEvent(pub, 'Akce tří')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await joins(event.id, clubOrgId, pub, club)
    expect(await coOrganizationsOf(event.id)).toEqual(
      expect.arrayContaining([villageObecOrg, clubOrgId]),
    )

    await expect(
      payload.update({
        collection: 'events',
        id: event.id,
        data: { coOrganizations: [clubOrgId] },
        user: pub,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/odebrat nemůžete/)

    await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [villageObecOrg] },
      user: villageAdmin,
      overrideAccess: false,
    })
    expect(await coOrganizationsOf(event.id)).toEqual([villageObecOrg])
    expect(await titlesFor(club)).toContain('Už akci nespolupořádáte')
  })

  it('the neighbour may also just leave — on its own, and be invited again later', async () => {
    const event = await makeEvent(pub, 'Akce, kterou soused opustí')
    await joins(event.id, villageObecOrg, pub, villageAdmin)

    const { token } = await payload.login({ collection: 'users', data: { email: villageAdmin.email, password: 'test1234' } })
    const response = await obecLeave(
      new Request(`http://localhost/api/events/${event.id}/obec-leave`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}` },
      }),
      { params: Promise.resolve({ id: String(event.id) }) },
    )
    expect(await response.json()).toEqual({ left: true })
    expect(await coOrganizationsOf(event.id)).not.toContain(villageObecOrg)
    const left = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    // Only the event's own obec leaves for good.
    expect(left.obecLeftAt ?? null).toBeNull()
    expect(left.status).not.toBe('cancelled')
    expect(await titlesFor(pub)).toContain('Obec akci už nespolupořádá')
    expect(await titlesFor(villageAdmin2)).toContain('Obec akci už nespolupořádá')

    await joins(event.id, villageObecOrg, pub, villageAdmin2)
    expect(await coOrganizationsOf(event.id)).toContain(villageObecOrg)
  })

  const leaveAs = async (user: TestUser, eventId: number) => {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
    return leave(
      new Request(`http://localhost/api/events/${eventId}/leave`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}` },
      }),
      { params: Promise.resolve({ id: String(eventId) }) },
    )
  }

  it("an organization co-organizing in the mikroregion leaves on its own — the pořadatel can't", async () => {
    const event = await makeEvent(mainAdmin, 'Obecní akce s klubem')
    await joins(event.id, villageObecOrg, mainAdmin, villageAdmin)
    await joins(event.id, clubOrgId, mainAdmin, club)

    expect((await leaveAs(mainAdmin, event.id)).status).toBe(409)
    const response = await leaveAs(club, event.id)
    expect(await response.json()).toEqual({ left: true })
    expect(await coOrganizationsOf(event.id)).toEqual([villageObecOrg])
    expect(await titlesFor(mainAdmin2)).toContain('Spolupořadatel akci opustil')
    expect(await titlesFor(villageAdmin2)).toContain('Spolupořadatel akci opustil')

    // …and may be invited again.
    await joins(event.id, clubOrgId, mainAdmin, club)
    expect(await coOrganizationsOf(event.id)).toContain(clubOrgId)

    const pubEvent = await makeEvent(pub, 'Akce podniku s klubem')
    await joins(pubEvent.id, clubOrgId, pub, club)
    expect((await leaveAs(pub, pubEvent.id)).status).toBe(409)
    expect(await (await leaveAs(club, pubEvent.id)).json()).toEqual({ left: true })
  })

  it("an organization's deletion request goes to the event's creator alone — not the obce", async () => {
    const event = await makeEvent(pub, 'Akce tří ke smazání')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await joins(event.id, clubOrgId, pub, club)
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [villageObecOrg, clubOrgId, await obecOrgOf(main)] },
      context: { coOrganizingApproved: true },
      overrideAccess: true,
    })
    await payload.delete({ collection: 'notifications', where: { user: { in: users.map((u) => u.id) } }, overrideAccess: true })

    const request = await requestDeletion(event.id, club)
    expect((request.approvers ?? []).map((a) => Number(typeof a === 'object' ? a.id : a))).toEqual([pub.id])
    expect(request.neighbourMunicipalities ?? []).toEqual([])
    expect(request.municipalityConsent).toBe(false)
    expect(await titlesFor(pub)).toContain('Žádost o smazání akce')
    for (const admin of [villageAdmin, villageAdmin2, mainAdmin, mainAdmin2]) {
      expect(await titlesFor(admin)).not.toContain('Žádost o smazání akce')
    }
    // Neither obec has a say in it.
    expect((await decideAs(villageAdmin, request.id, 'approve')).status).toBe(403)
    expect((await decideAs(mainAdmin, request.id, 'approve')).status).toBe(403)

    // The pořadatel agreeing makes it their own request — the rest still consent (not the club, who asked).
    expect(await (await decideAs(pub, request.id, 'approve')).json()).toEqual({ status: 'pending' })
    expect(await titlesFor(villageAdmin2)).toContain('Žádost o smazání akce')
    expect(await titlesFor(mainAdmin2)).toContain('Žádost o smazání akce')
    expect(await (await decideAs(villageAdmin2, request.id, 'approve')).json()).toEqual({ status: 'pending' })
    expect(await (await decideAs(mainAdmin, request.id, 'approve')).json()).toEqual({ status: 'approved' })
  })

  it("on the obec's own event, an organization's request goes to the obec's admins alone", async () => {
    const event = await makeEvent(mainAdmin, 'Obecní akce ke smazání')
    await joins(event.id, villageObecOrg, mainAdmin, villageAdmin)
    await joins(event.id, clubOrgId, mainAdmin, club)

    const request = await requestDeletion(event.id, club)
    expect(request.approvers ?? []).toEqual([])
    expect(request.neighbourMunicipalities ?? []).toEqual([])
    expect(request.municipalityConsent).toBe(true)
    expect((await decideAs(villageAdmin, request.id, 'approve')).status).toBe(403)
    expect(await (await decideAs(mainAdmin2, request.id, 'approve')).json()).toEqual({ status: 'approved' })
  })

  const eventOf = (id: number) => payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true })
  const idOf = (v: unknown) => (v == null ? null : Number(typeof v === 'object' ? (v as { id: number }).id : v))

  it('H1: nobody else may run it — the obec co-organizing takes the event over from its pořadatel', async () => {
    const event = await makeEvent(pub, 'Akce jen s obcemi')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await joins(event.id, await obecOrgOf(main), pub, mainAdmin)

    const request = await requestDeletion(event.id, pub)
    const response = await decideAs(mainAdmin2, request.id, 'remove-requester')
    expect(await response.json()).toEqual({ status: 'requester-removed' })
    const after = await eventOf(event.id)
    expect(idOf(after.organizer)).toBe(mainAdmin2.id)
    expect(idOf(after.organization)).toBe(await obecOrgOf(main))
    expect((after.coOrganizations ?? []).map(idOf)).toEqual([villageObecOrg])
    expect(after.obecLeftAt ?? null).toBeNull()
  })

  it('H1: escalated with nobody else to run it — the obec takes it over instead of failing', async () => {
    const event = await makeEvent(pub, 'Akce se sousedem, který nechce smazat')
    await joins(event.id, villageObecOrg, pub, villageAdmin)

    const request = await requestDeletion(event.id, pub)
    expect(await (await decideAs(villageAdmin, request.id, 'reject')).json()).toEqual({ status: 'rejected' })
    expect((await postAs(escalate, 'escalate', pub, request.id, {})).status).toBe(200)
    const response = await postAs(municipalityDecide, 'municipality-decide', mainAdmin, request.id, { remove: true })
    expect(await response.json()).toEqual({ status: 'requester-removed' })
    const after = await eventOf(event.id)
    expect(idOf(after.organizer)).toBe(mainAdmin.id)
    expect(idOf(after.organization)).toBe(await obecOrgOf(main))
  })

  it("H1: a neighbour's business can't take the event over — it's told so up front", async () => {
    const event = await makeEvent(pub, 'Akce se sousedním podnikem')
    await joins(event.id, villageClubOrgId, pub, villageClub)
    const request = await requestDeletion(event.id, pub)
    const response = await decideAs(villageClub, request.id, 'remove-requester')
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/nemáte roli organizátora/)
  })

  it('H3: a neighbouring obec without an admin holds nothing up', async () => {
    const event = await makeEvent(pub, 'Akce s obcí bez admina')
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [lonelyObecOrg] },
      context: { coOrganizingApproved: true },
      overrideAccess: true,
    })
    const cancelled = await cancelAs(pub, event.id)
    expect(cancelled.status).toBe('cancelled')
  })

  it('M1: a neighbouring obec editing the event lists whom to invite', async () => {
    const event = await makeEvent(pub, 'Akce, kam soused zve')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    const { token } = await payload.login({ collection: 'users', data: { email: villageAdmin.email, password: 'test1234' } })
    const ask = (withEvent: boolean) =>
      candidates(
        new Request(
          `http://localhost/api/events/co-organizer-candidates?municipalityId=${main.id}${withEvent ? `&eventId=${event.id}` : ''}`,
          { headers: { Authorization: `JWT ${token}` } },
        ),
      )
    expect((await ask(false)).status).toBe(403)
    const response = await ask(true)
    expect(response.status).toBe(200)
    const ids = ((await response.json()).docs as { id: string }[]).map((d) => Number(d.id))
    expect(ids).toContain(clubOrgId)
  })

  it("M3: a neighbouring obec takes nobody off the obec's own event", async () => {
    const event = await makeEvent(mainAdmin, 'Obecní akce, kde soused neodebírá')
    await joins(event.id, villageObecOrg, mainAdmin, villageAdmin)
    await joins(event.id, clubOrgId, mainAdmin, club)
    await expect(
      payload.update({
        collection: 'events',
        id: event.id,
        data: { coOrganizations: [villageObecOrg] },
        user: villageAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/odebrat nemůžete/)
  })

  it("L1: a neighbouring obec's admins see who's signed up", async () => {
    const event = await makeEvent(pub, 'Akce s přihláškou')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    const resident = await makeUser('resident', main)
    await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: resident.id, status: 'approved' } as never,
      overrideAccess: true,
    })
    const seen = await payload.find({
      collection: 'registrations',
      where: { event: { equals: event.id } },
      user: villageAdmin,
      overrideAccess: false,
    })
    expect(seen.docs.map((r) => idOf(r.user))).toContain(resident.id)
    await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true })
  })

  it('L2: two consents at once are both counted', async () => {
    const event = await makeEvent(pub, 'Akce, kde souhlasí dva naráz')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await joins(event.id, clubOrgId, pub, club)
    const request = await requestDeletion(event.id, pub)
    const answers = await Promise.all([
      decideAs(club, request.id, 'approve').then((r) => r.json()),
      decideAs(villageAdmin, request.id, 'approve').then((r) => r.json()),
    ])
    expect(answers.map((a) => a.status).sort()).toEqual(['approved', 'pending'])
    expect(await eventOf(event.id).catch(() => null)).toBeNull()
  })

  it('L3: nobody leaves in the last hours before the start', async () => {
    const event = await makeEvent(pub, 'Akce za dvě hodiny', 2 * 60 * 60 * 1000)
    await joins(event.id, clubOrgId, pub, club)
    const response = await leaveAs(club, event.id)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/nejpozději 3 hodiny/)
  })

  it("volunteering stays the event creator's alone — no neighbouring obec, neighbour's business or the obec co-organizing it", async () => {
    const event = await makeEvent(pub, 'Akce s dobrovolníky v mikroregionu')
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await joins(event.id, villageClubOrgId, pub, villageClub)
    await joins(event.id, await obecOrgOf(main), pub, mainAdmin)
    const outsiders = [villageAdmin, villageClub, mainAdmin]

    // The flag — anyone else's change of it is simply dropped (Events guardIsVolunteering).
    for (const user of outsiders) {
      const saved = await payload.update({
        collection: 'events',
        id: event.id,
        data: { isVolunteering: true },
        user,
        overrideAccess: false,
      })
      expect(saved.isVolunteering).toBe(false)
    }
    await payload.update({ collection: 'events', id: event.id, data: { isVolunteering: true }, user: pub, overrideAccess: false })

    // Inviting a volunteer from the neighbouring obec.
    const volunteer = await makeUser('village-volunteer', village)
    await payload.update({
      collection: 'profiles',
      where: { user: { equals: volunteer.id } },
      data: {
        isVolunteer: true,
        volunteerMunicipality: village.id,
        volunteerFocus: ['akce'],
        volunteerAllowEmail: true,
        volunteerContactEmail: `coorg-volunteer-contact-${STAMP}@test.local`,
      } as never,
      overrideAccess: true,
      // Joining the pool is the volunteer's own act — done as them.
      user: volunteer,
    })
    const invite = (user: TestUser) =>
      payload.create({
        collection: 'volunteer-invitations',
        data: { event: event.id, volunteer: volunteer.id, kind: 'invitation' } as never,
        user,
        overrideAccess: false,
      })
    for (const user of outsiders) await expect(invite(user)).rejects.toThrow()
    const invitation = await invite(pub)

    // Taking the invitation back.
    for (const user of outsiders) {
      await expect(
        payload.update({
          collection: 'volunteer-invitations',
          id: invitation.id,
          data: { status: 'withdrawn' },
          user,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    }

    // The volunteer accepts — then only the creator takes them off.
    await payload.update({
      collection: 'volunteer-invitations',
      id: invitation.id,
      data: { status: 'accepted' },
      user: volunteer,
      overrideAccess: false,
    })
    const registration = (
      await payload.find({
        collection: 'registrations',
        where: { and: [{ event: { equals: event.id } }, { user: { equals: volunteer.id } }] },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]!
    expect(registration.role).toBe('volunteer')
    for (const user of outsiders) {
      await expect(
        payload.update({
          collection: 'registrations',
          id: registration.id,
          data: { status: 'rejected' },
          user,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/jen pořadatel, který ji založil/)
    }

    await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true })
    await payload.delete({ collection: 'volunteer-invitations', where: { event: { equals: event.id } }, overrideAccess: true })
  })

  it("manual approval is the creator's alone — participants and volunteers, whoever co-organizes", async () => {
    const event = await makeEvent(pub, 'Akce se schvalováním')
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { registrationApprovalMode: 'manual' } as never,
      overrideAccess: true,
    })
    await joins(event.id, villageObecOrg, pub, villageAdmin)
    await joins(event.id, clubOrgId, pub, club)
    await joins(event.id, await obecOrgOf(main), pub, mainAdmin)
    await payload.delete({ collection: 'notifications', where: { user: { in: users.map((u) => u.id) } }, overrideAccess: true })

    const applicant = await makeUser('applicant', main)
    const registration = await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: applicant.id, status: 'pending' } as never,
      user: applicant,
      overrideAccess: false,
    })
    // Only the creator hears there's one to decide.
    expect(await titlesFor(pub)).toContain('Nová přihláška na akci')
    for (const user of [club, villageAdmin, villageAdmin2, mainAdmin, mainAdmin2]) {
      expect(await titlesFor(user)).not.toContain('Nová přihláška na akci')
    }
    for (const user of [club, villageAdmin, mainAdmin]) {
      for (const status of ['approved', 'rejected'] as const) {
        await expect(
          payload.update({ collection: 'registrations', id: registration.id, data: { status }, user, overrideAccess: false }),
        ).rejects.toThrow(/jen pořadatel, který akci založil/)
      }
    }
    const approved = await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: { status: 'approved' },
      user: pub,
      overrideAccess: false,
    })
    expect(approved.status).toBe('approved')
    await payload.delete({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true })
  })

  it('M2: the obce taken apart — joint events run on, pending invitations across them lapse', async () => {
    const running = await makeEvent(pub, 'Společná akce, která doběhne')
    await joins(running.id, villageObecOrg, pub, villageAdmin)
    await joins(running.id, villageClubOrgId, pub, villageClub)
    const pendingFor = await makeEvent(pub, 'Akce s nepřijatou pozvánkou')
    const invitation = await payload.create({
      collection: 'co-organizing-requests',
      data: { event: pendingFor.id, organization: villageObecOrg } as never,
      user: pub,
      overrideAccess: false,
    })

    const { token } = await payload.login({ collection: 'users', data: { email: superadmin.email, password: 'test1234' } })
    const impact = await regionImpact(
      new Request(`http://localhost/api/admin/microregions/impact?regionId=${regionId}&municipalityIds=${main.id},${lonely.id}`, {
        headers: { Authorization: `JWT ${token}` },
      }),
    )
    expect(((await impact.json()).events as { id: string }[]).map((e) => Number(e.id))).toContain(running.id)

    await payload.delete({ collection: 'notifications', where: { user: { in: users.map((u) => u.id) } }, overrideAccess: true })
    await payload.update({
      collection: 'microregions',
      id: regionId,
      data: { municipalities: [main.id, lonely.id] },
      overrideAccess: true,
    })

    const lapsed = await payload.findByID({ collection: 'co-organizing-requests', id: invitation.id, overrideAccess: true })
    expect(lapsed.status).toBe('expired')
    expect(await titlesFor(pub)).toContain('Pozvánka ke spolupořádání zrušena')
    const villageNotice = await payload.find({
      collection: 'notifications',
      where: { user: { equals: villageAdmin.id } },
      overrideAccess: true,
    })
    expect(villageNotice.docs.map((n) => n.message).join(' ')).toContain('Společná akce, která doběhne')

    // The co-operation runs on its rules: the neighbour's business still leaves on its own.
    expect((await eventOf(running.id)).coOrganizations?.map(idOf)).toEqual(
      expect.arrayContaining([villageObecOrg, villageClubOrgId]),
    )
    expect(await (await leaveAs(villageClub, running.id)).json()).toEqual({ left: true })
  })

})
