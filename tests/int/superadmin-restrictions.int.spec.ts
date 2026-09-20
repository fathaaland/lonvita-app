import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// What the /superadmin panel is allowed to do, enforced where it counts — in the collections,
// not just in the panel's UI. Covers: deleting an account the panel itself provisioned, handing
// out the platform role, and making someone a pořadatel without the obec role.

let payload: Payload

let municipality: { id: number }
let otherMunicipality: { id: number }
let category: { id: number }
let superadmin: { id: number; email: string; role: string }

const STAMP = Date.now()

const createAccount = async (label: string) =>
  payload.create({
    collection: 'users',
    data: { email: `${label}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  })

/** What POST /api/superadmin/create-user leaves behind: the account, a full profile and a
 * "participant" role in the chosen obec. */
const provisionFromPanel = async (label: string) => {
  const user = await createAccount(label)
  await payload.create({
    collection: 'profiles',
    data: { user: user.id, fullName: `Panel User ${label}`, municipality: municipality.id },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'user-roles',
    data: { user: user.id, municipality: municipality.id, role: 'participant' },
    overrideAccess: true,
  })
  return user
}

const eventData = (organizerId: number, municipalityId: number) => ({
  title: `Superadmin restrictions ${STAMP}-${organizerId}`,
  dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  locationText: 'Test location',
  lat: 49.5661,
  lng: 15.9403,
  capacity: 10,
  organizer: organizerId,
  municipality: municipalityId,
  categories: [category.id],
  status: 'active' as const,
  isPaid: false,
  registrationApprovalMode: 'manual' as const,
  cancellationPolicy: 'none' as const,
})

describe('Superadmin restrictions', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Superadmin ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    otherMunicipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Superadmin Other ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Superadmin ${STAMP}` },
      overrideAccess: true,
    })
    superadmin = await payload.create({
      collection: 'users',
      data: { email: `superadmin-${STAMP}@test.local`, password: 'test1234', role: 'admin' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload
      .delete({ collection: 'events', where: { municipality: { in: [municipality.id, otherMunicipality.id] } }, overrideAccess: true })
      .catch(() => {})
    await payload.delete({ collection: 'users', id: superadmin.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: otherMunicipality.id, overrideAccess: true }).catch(() => {})
  })

  describe('deleting an account', () => {
    it('deletes an account the panel provisioned, together with its profile and roles', async () => {
      const user = await provisionFromPanel('provisioned')

      const deleted = await payload.delete({
        collection: 'users',
        id: user.id,
        user: superadmin,
        overrideAccess: false,
      })
      expect(deleted.id).toBe(user.id)

      const profiles = await payload.find({
        collection: 'profiles',
        where: { user: { equals: user.id } },
        overrideAccess: true,
      })
      const roles = await payload.find({
        collection: 'user-roles',
        where: { user: { equals: user.id } },
        overrideAccess: true,
      })
      expect(profiles.totalDocs).toBe(0)
      expect(roles.totalDocs).toBe(0)
    })

    it("deletes an account's registrations and notifications along with it", async () => {
      const organizer = await createAccount('reg-organizer')
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
        overrideAccess: true,
      })
      const event = await payload.create({
        collection: 'events',
        data: eventData(organizer.id, municipality.id),
        context: { skipNotifications: true },
        overrideAccess: true,
      })

      const participant = await provisionFromPanel('registered')
      await payload.create({
        collection: 'registrations',
        data: { event: event.id, user: participant.id, status: 'approved' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'notifications',
        data: { user: participant.id, title: 'Test', message: 'Test' },
        overrideAccess: true,
      })

      await payload.delete({ collection: 'users', id: participant.id, user: superadmin, overrideAccess: false })

      const registrations = await payload.find({
        collection: 'registrations',
        where: { user: { equals: participant.id } },
        overrideAccess: true,
      })
      const notifications = await payload.find({
        collection: 'notifications',
        where: { user: { equals: participant.id } },
        overrideAccess: true,
      })
      expect(registrations.totalDocs).toBe(0)
      expect(notifications.totalDocs).toBe(0)
    })

    it('refuses to delete an account that still organizes events, and says why', async () => {
      const organizer = await createAccount('busy-organizer')
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'events',
        data: eventData(organizer.id, municipality.id),
        context: { skipNotifications: true },
        overrideAccess: true,
      })

      await expect(
        payload.delete({ collection: 'users', id: organizer.id, user: superadmin, overrideAccess: false }),
      ).rejects.toThrow(/pořadatelem/)

      const stillThere = await payload.findByID({ collection: 'users', id: organizer.id, overrideAccess: true })
      expect(stillThere.id).toBe(organizer.id)
    })
  })

  describe('the platform role', () => {
    it('cannot be granted to another account over the API, not even by a superadmin', async () => {
      const user = await createAccount('would-be-admin')

      await expect(
        payload.update({
          collection: 'users',
          id: user.id,
          data: { role: 'admin' },
          user: superadmin,
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      const unchanged = await payload.findByID({ collection: 'users', id: user.id, overrideAccess: true })
      expect(unchanged.role).toBe('user')

      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true })
    })

    it('cannot be taken away from an existing superadmin either', async () => {
      await expect(
        payload.update({
          collection: 'users',
          id: superadmin.id,
          data: { role: 'user' },
          user: superadmin,
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      const unchanged = await payload.findByID({ collection: 'users', id: superadmin.id, overrideAccess: true })
      expect(unchanged.role).toBe('admin')
    })
  })

  describe('who may be a pořadatel', () => {
    it('refuses an event whose organizer holds no role in that obec', async () => {
      const participant = await provisionFromPanel('no-organizer-role')

      await expect(
        payload.create({
          collection: 'events',
          data: eventData(participant.id, municipality.id),
          user: superadmin,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/Organiz/)

      await payload.delete({ collection: 'users', id: participant.id, overrideAccess: true })
    })

    it('refuses an organizer whose role is in a different obec', async () => {
      const organizer = await createAccount('elsewhere-organizer')
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: otherMunicipality.id, role: 'organizer' },
        overrideAccess: true,
      })

      await expect(
        payload.create({
          collection: 'events',
          data: eventData(organizer.id, municipality.id),
          user: superadmin,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/Organiz/)
    })

    it('accepts the same event once the organizer holds the role', async () => {
      const organizer = await createAccount('promoted-organizer')
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: municipality.id, role: 'municipality_admin' },
        overrideAccess: true,
      })

      const event = await payload.create({
        collection: 'events',
        data: eventData(organizer.id, municipality.id),
        user: superadmin,
        context: { skipNotifications: true },
        overrideAccess: false,
      })
      expect(event.id).toBeDefined()
    })

    it('still allows editing an event without touching its organizer', async () => {
      const organizer = await createAccount('editable-organizer')
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
        overrideAccess: true,
      })
      const event = await payload.create({
        collection: 'events',
        data: eventData(organizer.id, municipality.id),
        context: { skipNotifications: true },
        overrideAccess: true,
      })

      // The role goes away — an older event still has to stay editable.
      await payload.delete({
        collection: 'user-roles',
        where: { user: { equals: organizer.id } },
        overrideAccess: true,
      })

      const updated = await payload.update({
        collection: 'events',
        id: event.id,
        data: { title: `Renamed ${STAMP}` },
        user: superadmin,
        context: { skipNotifications: true },
        overrideAccess: false,
      })
      expect(updated.title).toBe(`Renamed ${STAMP}`)
    })
  })
})
