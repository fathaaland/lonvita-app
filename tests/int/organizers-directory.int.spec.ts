import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { loadOrganizersDirectory, organizesIn } from '@/lib/organizers-directory'

let payload: Payload

type TestUser = { id: number; email: string; role: string }

let municipality: { id: number }
let category: { id: number }
let cafe: TestUser
let club: TestUser
let obecAdmin: TestUser
let applicant: TestUser
let participant: TestUser

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createUser = async (name: string): Promise<TestUser> => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `orgdir-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Orgdir ${name}`, municipality: municipality.id, notifyEmail: false },
    overrideAccess: true,
  })
  return user as TestUser
}

describe('Organizátoři v mém městě', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Orgdir Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Orgdir Category ${STAMP}` },
      overrideAccess: true,
    })
    cafe = await createUser('cafe')
    club = await createUser('club')
    obecAdmin = await createUser('admin')
    applicant = await createUser('applicant')
    participant = await createUser('participant')

    await payload.create({
      collection: 'user-roles',
      data: { user: obecAdmin.id, municipality: municipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: club.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })

    // The café becomes an organizer the usual way — the obec approves its request.
    const request = await payload.create({
      collection: 'organizer-requests',
      data: {
        user: cafe.id,
        municipality: municipality.id,
        reason: 'Kavárna na náměstí, pořádáme čtení a odpolední setkání u kávy.',
        organizationName: `Kavárna ${STAMP}`,
        organizationType: 'business',
      },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'organizer-requests',
      id: request.id,
      data: { status: 'approved' },
      user: obecAdmin,
      overrideAccess: true,
    })
    await payload.create({
      collection: 'organizer-requests',
      data: {
        user: applicant.id,
        municipality: municipality.id,
        reason: 'Chtěla bych pořádat vycházky pro seniory.',
        organizationName: `Vycházky ${STAMP}`,
        organizationType: 'individual',
      },
      overrideAccess: true,
    })

    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Orgdir event ${STAMP}`,
        dateTime: new Date(Date.now() + 3 * DAY).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 4,
        organizer: cafe.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventIds.push(event.id)
    await payload.create({
      collection: 'registrations',
      data: { event: event.id, user: participant.id, status: 'approved' },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const userIds = [cafe.id, club.id, obecAdmin.id, applicant.id, participant.id]
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true, context: { deletingMunicipality: true } })
      .catch(() => {})
  })

  it('is for the obec admin and its organizers — not for an applicant still waiting, nor a participant', async () => {
    expect(await organizesIn(payload, obecAdmin, String(municipality.id))).toBe(true)
    expect(await organizesIn(payload, cafe, String(municipality.id))).toBe(true)
    expect(await organizesIn(payload, applicant, String(municipality.id))).toBe(false)
    expect(await organizesIn(payload, participant, String(municipality.id))).toBe(false)
  })

  it('lists every organizer of the obec with its description and numbers, but not the obec itself', async () => {
    const directory = await loadOrganizersDirectory(payload, String(municipality.id), club.id)
    expect(directory.map((o) => o.name).sort()).toEqual([`Kavárna ${STAMP}`, 'Orgdir club'].sort())

    const cafeProfile = directory.find((o) => o.name === `Kavárna ${STAMP}`)!
    // What the café told the obec when asking for the role.
    expect(cafeProfile.description).toBe('Kavárna na náměstí, pořádáme čtení a odpolední setkání u kávy.')
    expect(cafeProfile.type).toBe('business')
    expect(cafeProfile.stats).toMatchObject({ eventCount: 1, people: 1, fillRate: 0.25 })
    expect(cafeProfile.next_event?.title).toBe(`Orgdir event ${STAMP}`)
    expect(cafeProfile.is_own).toBe(false)
    expect(cafeProfile).not.toHaveProperty('feedback')
  })

  it('the owner edits the description; nobody else but the obec may', async () => {
    const [organization] = (
      await payload.find({
        collection: 'organizations',
        where: { owner: { equals: cafe.id } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs
    await payload.update({
      collection: 'organizations',
      id: organization.id,
      data: { description: '  Nově i jazzové večery.  ' },
      user: cafe,
      overrideAccess: false,
    })
    await expect(
      payload.update({
        collection: 'organizations',
        id: organization.id,
        data: { description: 'Přepsáno jiným pořadatelem' },
        user: club,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    const read = await payload.findByID({ collection: 'organizations', id: organization.id, overrideAccess: true })
    expect(read.description).toBe('Nově i jazzové večery.')
  })

  it("shows each organizer's account e-mail as the contact", async () => {
    const directory = await loadOrganizersDirectory(payload, String(municipality.id), club.id)
    expect(directory.find((o) => o.name === `Kavárna ${STAMP}`)!.contact).toEqual({ email: cafe.email })
  })
})
