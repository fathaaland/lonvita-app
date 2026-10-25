// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { inSameRegion, regionMunicipalityIds } from '@/lib/microregions'
import { municipalityOrganizationIds } from '@/collections/Organizations'

// Mikroregion: obce sharing one view — each other's events, volunteers and co-organizing; everything
// else stays with the obec. One region per obec; an obec without one stands alone.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe('Mikroregiony', () => {
  let main: { id: number }
  let village: { id: number }
  let outsider: { id: number }
  let category: { id: number }
  let organizer: TestUser
  let villageAdmin: TestUser
  let mainAdmin: TestUser
  let villageOrganizer: TestUser
  let outsiderOrganizer: TestUser
  let villageVolunteer: TestUser
  let outsiderVolunteer: TestUser
  let region: { id: number }
  let eventId: number
  const users: TestUser[] = []

  const makeMuni = (name: string) =>
    payload.create({
      collection: 'municipalities',
      data: {
        name: `Region ${name} ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })

  const makeUser = async (
    name: string,
    municipality: { id: number },
    profile: Record<string, unknown> = {},
  ) => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `region-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as TestUser
    await payload.create({
      collection: 'profiles',
      data: {
        user: user.id,
        fullName: `Region ${name}`,
        municipality: municipality.id,
        notifyEmail: false,
        ...profile,
      },
      overrideAccess: true,
    })
    users.push(user)
    return user
  }

  const volunteerOf = (municipality: { id: number }, name: string) =>
    makeUser(name, municipality, {
      isVolunteer: true,
      volunteerMunicipality: municipality.id,
      volunteerFocus: ['akce'],
      volunteerAllowEmail: true,
      volunteerContactEmail: `region-${name}-contact-${STAMP}@test.local`,
    })

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

  const organizationOf = async (owner: TestUser, municipality: { id: number }) =>
    (
      await payload.find({
        collection: 'organizations',
        where: {
          and: [{ owner: { equals: owner.id } }, { municipality: { equals: municipality.id } }],
        },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0] ??
    (await payload.create({
      collection: 'organizations',
      data: {
        name: `Region org ${owner.id} ${STAMP}`,
        type: 'association',
        owner: owner.id,
        municipality: municipality.id,
      },
      overrideAccess: true,
    }))

  const invite = (organizationId: number | string) =>
    payload.create({
      collection: 'co-organizing-requests',
      data: { event: eventId, organization: Number(organizationId) } as never,
      user: organizer,
      overrideAccess: false,
    })

  const inviteVolunteer = (volunteer: TestUser) =>
    payload.create({
      collection: 'volunteer-invitations',
      data: { event: eventId, volunteer: volunteer.id, kind: 'invitation' } as never,
      user: organizer,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    main = await makeMuni('Main')
    village = await makeMuni('Village')
    outsider = await makeMuni('Outsider')
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Region ${STAMP}` },
      overrideAccess: true,
    })

    organizer = await makeUser('organizer', main)
    villageAdmin = await makeUser('village-admin', village)
    mainAdmin = await makeUser('main-admin', main)
    villageOrganizer = await makeUser('village-organizer', village)
    outsiderOrganizer = await makeUser('outsider-organizer', outsider)
    villageVolunteer = await volunteerOf(village, 'village-volunteer')
    outsiderVolunteer = await volunteerOf(outsider, 'outsider-volunteer')
    await grant(organizer, main, 'organizer')
    await grant(villageAdmin, village, 'municipality_admin')
    await grant(mainAdmin, main, 'municipality_admin')
    await grant(villageOrganizer, village, 'organizer')
    await grant(outsiderOrganizer, outsider, 'organizer')

    region = await payload.create({
      collection: 'microregions',
      data: {
        name: `Region ${STAMP}`,
        municipalities: [main.id, village.id],
        mainMunicipality: main.id,
      },
      overrideAccess: true,
    })

    eventId = (
      await payload.create({
        collection: 'events',
        data: {
          title: `Region event ${STAMP}`,
          dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
          locationText: 'Náves',
          lat: 49.5661,
          lng: 15.9403,
          capacity: 10,
          organizer: organizer.id,
          municipality: main.id,
          categories: [category.id],
          isPaid: false,
          isVolunteering: true,
          registrationApprovalMode: 'auto',
        } as never,
        user: organizer,
        overrideAccess: false,
      })
    ).id
  })

  afterAll(async () => {
    const userIds = users.map((u) => u.id)
    await payload
      .delete({
        collection: 'microregions',
        where: { name: { contains: `${STAMP}` } },
        overrideAccess: true,
      })
      .catch(() => {})
    await payload
      .delete({
        collection: 'volunteer-invitations',
        where: { event: { equals: eventId } },
        overrideAccess: true,
      })
      .catch(() => {})
    await payload
      .delete({
        collection: 'co-organizing-requests',
        where: { event: { equals: eventId } },
        overrideAccess: true,
      })
      .catch(() => {})
    for (const id of [eventId, ...extraEventIds]) {
      await payload
        .delete({ collection: 'co-organizing-requests', where: { event: { equals: id } }, overrideAccess: true })
        .catch(() => {})
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload
      .delete({
        collection: 'notifications',
        where: { user: { in: userIds } },
        overrideAccess: true,
      })
      .catch(() => {})
    await payload
      .delete({
        collection: 'organizations',
        where: { owner: { in: userIds } },
        overrideAccess: true,
      })
      .catch(() => {})
    await payload
      .delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'event-categories', id: category.id, overrideAccess: true })
      .catch(() => {})
    for (const m of [main, village, outsider])
      await payload
        .delete({ collection: 'municipalities', id: m.id, overrideAccess: true })
        .catch(() => {})
  })

  it('knows which obce belong together — an obec without a region stands alone', async () => {
    expect((await regionMunicipalityIds(payload, main.id)).sort()).toEqual(
      [String(main.id), String(village.id)].sort(),
    )
    expect(await regionMunicipalityIds(payload, outsider.id)).toEqual([String(outsider.id)])
    expect(await inSameRegion(payload, village.id, main.id)).toBe(true)
    expect(await inSameRegion(payload, outsider.id, main.id)).toBe(false)
  })

  const notificationTitles = async (user: TestUser) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { user: { equals: user.id } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs.map((n) => n.title)

  it("tells the obec's admins it joined the region — and with whom it shares", async () => {
    const notifications = await payload.find({
      collection: 'notifications',
      where: { user: { equals: villageAdmin.id } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const joined = notifications.docs.find((n) => n.title.includes(`je v mikroregionu Region ${STAMP}`))
    expect(joined?.message).toContain(`s obcí Region Main ${STAMP}`)
  })

  it('an obec is in one region at most, and only the platform admin keeps them', async () => {
    await expect(
      payload.create({
        collection: 'microregions',
        data: { name: `Second ${STAMP}`, municipalities: [village.id, outsider.id] },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      payload.create({
        collection: 'microregions',
        data: { name: `By an obec admin ${STAMP}`, municipalities: [outsider.id] },
        user: villageAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    // The main obec is one of its members — the first, when none is picked.
    const lone = await payload.create({
      collection: 'microregions',
      data: { name: `Lone ${STAMP}`, municipalities: [outsider.id] },
      overrideAccess: true,
    })
    expect(
      Number(
        typeof lone.mainMunicipality === 'object'
          ? lone.mainMunicipality?.id
          : lone.mainMunicipality,
      ),
    ).toBe(outsider.id)
    await payload.delete({ collection: 'microregions', id: lone.id, overrideAccess: true })
  })

  it('invites organizations and obce of the region to co-organize — not from outside it', async () => {
    const villageOrg = await organizationOf(villageOrganizer, village)
    const request = await invite(villageOrg.id)
    expect(
      Number(
        typeof request.municipality === 'object' ? request.municipality.id : request.municipality,
      ),
    ).toBe(village.id)

    const villageObecOrg = (
      await municipalityOrganizationIds({ payload, context: {} } as never, [village.id])
    ).get(String(village.id))!
    await invite(villageObecOrg)

    const outsiderOrg = await organizationOf(outsiderOrganizer, outsider)
    await expect(invite(outsiderOrg.id)).rejects.toMatchObject({ status: 400 })
  })

  it('a neighbouring obec co-organizing the event may edit it', async () => {
    const villageObecOrg = (
      await municipalityOrganizationIds({ payload, context: {} } as never, [village.id])
    ).get(String(village.id))!
    await expect(
      payload.update({
        collection: 'events',
        id: eventId,
        data: { description: 'Upraví soused' },
        user: villageAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    // Accepted: the obec is on the event.
    await payload.update({
      collection: 'events',
      id: eventId,
      data: { coOrganizations: [Number(villageObecOrg)] },
      context: { coOrganizingApproved: true },
      overrideAccess: true,
    })
    const edited = await payload.update({
      collection: 'events',
      id: eventId,
      data: { description: 'Upraví soused' },
      user: villageAdmin,
      overrideAccess: false,
    })
    expect(edited.description).toBe('Upraví soused')
  })

  const obecOrganizationOf = async (municipality: { id: number }) =>
    (await municipalityOrganizationIds({ payload, context: {} } as never, [String(municipality.id)])).get(
      String(municipality.id),
    )!

  const extraEventIds: number[] = []
  const makeEvent = async (by: TestUser, title: string) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `${title} ${STAMP}`,
        dateTime: new Date(Date.now() + 6 * DAY).toISOString(),
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
    extraEventIds.push(event.id)
    return event
  }

  it("the obec's own event: its admin invites a neighbouring obec, whose admin accepts", async () => {
    const event = await makeEvent(mainAdmin, 'Obecní akce')
    expect(String(typeof event.organization === 'object' ? event.organization?.id : event.organization)).toBe(
      await obecOrganizationOf(main),
    )
    const villageObecOrg = await obecOrganizationOf(village)
    const request = await payload.create({
      collection: 'co-organizing-requests',
      data: { event: event.id, organization: Number(villageObecOrg) } as never,
      user: mainAdmin,
      overrideAccess: false,
    })
    expect(request.status).toBe('pending')
    // The neighbour's admins decide — not the inviting obec.
    expect(Number(typeof request.municipality === 'object' ? request.municipality.id : request.municipality)).toBe(
      village.id,
    )
    await payload.update({
      collection: 'co-organizing-requests',
      id: request.id,
      data: { status: 'approved' },
      user: villageAdmin,
      overrideAccess: false,
    })
    const updated = await payload.findByID({ collection: 'events', id: event.id, depth: 0, overrideAccess: true })
    expect((updated.coOrganizations ?? []).map(String)).toContain(villageObecOrg)
  })

  it('an obec outside the region is not invited, not even to the obec\'s own event', async () => {
    const event = await makeEvent(mainAdmin, 'Obecní akce bez souseda')
    await expect(
      payload.create({
        collection: 'co-organizing-requests',
        data: { event: event.id, organization: Number(await obecOrganizationOf(outsider)) } as never,
        user: mainAdmin,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('the event\'s obec having left it does not shut out a neighbouring obec', async () => {
    const event = await makeEvent(organizer, 'Akce bez obce')
    const mainObecOrg = await obecOrganizationOf(main)
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [Number(mainObecOrg)] },
      context: { coOrganizingApproved: true },
      overrideAccess: true,
    })
    const left = await payload.update({
      collection: 'events',
      id: event.id,
      data: { coOrganizations: [] },
      overrideAccess: true,
    })
    expect(left.obecLeftAt).toBeTruthy()

    const request = await payload.create({
      collection: 'co-organizing-requests',
      data: { event: event.id, organization: Number(await obecOrganizationOf(village)) } as never,
      user: organizer,
      overrideAccess: false,
    })
    expect(request.status).toBe('pending')
    // …but the obec that left still can't come back.
    await expect(
      payload.create({
        collection: 'co-organizing-requests',
        data: { event: event.id, organization: Number(mainObecOrg) } as never,
        user: organizer,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("invites volunteers who help in the region — a volunteer from outside it isn't reachable", async () => {
    await inviteVolunteer(villageVolunteer)
    await expect(inviteVolunteer(outsiderVolunteer)).rejects.toMatchObject({ status: 400 })
  })

  it("once the region is gone, the village's volunteers are out of the main obec's reach", async () => {
    await payload.delete({ collection: 'microregions', id: region.id, overrideAccess: true })
    await payload.delete({
      collection: 'volunteer-invitations',
      where: { event: { equals: eventId } },
      overrideAccess: true,
    })
    await expect(inviteVolunteer(villageVolunteer)).rejects.toMatchObject({ status: 400 })
    expect(await notificationTitles(villageAdmin)).toContainEqual(
      expect.stringContaining(`už není v mikroregionu Region ${STAMP}`),
    )
  })
})
