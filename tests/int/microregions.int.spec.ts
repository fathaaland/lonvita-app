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
    villageOrganizer = await makeUser('village-organizer', village)
    outsiderOrganizer = await makeUser('outsider-organizer', outsider)
    villageVolunteer = await volunteerOf(village, 'village-volunteer')
    outsiderVolunteer = await volunteerOf(outsider, 'outsider-volunteer')
    await grant(organizer, main, 'organizer')
    await grant(villageAdmin, village, 'municipality_admin')
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
    await payload
      .delete({ collection: 'events', id: eventId, overrideAccess: true })
      .catch(() => {})
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
  })
})
