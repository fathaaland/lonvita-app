import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// A draft (koncept, isDraft) — its creator's alone until published: gone for everybody else, link or
// no link, the obec's admins included; takes no sign-ups or invitations. Back to a draft only while
// nobody is on the event.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe('A draft event', () => {
  let muni: { id: number }
  let category: { id: number }
  let organizer: TestUser
  let obecAdmin: TestUser
  let stranger: TestUser
  let eventId: number
  const users: TestUser[] = []

  const makeUser = async (name: string) => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `draft-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as TestUser
    users.push(user)
    return user
  }

  const sees = async (viewer: TestUser | null, id = eventId) => {
    const found = await payload.find({
      collection: 'events',
      where: { id: { equals: id } },
      depth: 0,
      ...(viewer ? { user: viewer } : {}),
      overrideAccess: false,
    })
    return found.totalDocs === 1
  }

  const createAs = (user: TestUser, isDraft: boolean) =>
    payload.create({
      collection: 'events',
      data: {
        title: `Draft ${STAMP} ${Math.random()}`,
        dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: user.id,
        municipality: muni.id,
        categories: [category.id],
        isPaid: false,
        isDraft,
        registrationApprovalMode: 'auto',
      } as never,
      user,
      overrideAccess: false,
    })

  const setDraft = (id: number, isDraft: boolean, user: TestUser) =>
    payload.update({ collection: 'events', id, data: { isDraft }, user, overrideAccess: false })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Draft ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `Draft ${STAMP}` }, overrideAccess: true })
    organizer = await makeUser('organizer')
    obecAdmin = await makeUser('obec-admin')
    stranger = await makeUser('stranger')
    await payload.create({ collection: 'user-roles', data: { user: obecAdmin.id, municipality: muni.id, role: 'municipality_admin' }, overrideAccess: true })
    await payload.create({ collection: 'user-roles', data: { user: organizer.id, municipality: muni.id, role: 'organizer' }, overrideAccess: true })
    eventId = (await createAs(organizer, true)).id
  })

  afterAll(async () => {
    const userIds = users.map((u) => u.id)
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { municipality: { equals: muni.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  it("is its creator's alone — not a guest's, a stranger's, nor the obec admin's, even by its id", async () => {
    expect(await sees(organizer)).toBe(true)
    expect(await sees(null)).toBe(false)
    expect(await sees(stranger)).toBe(false)
    expect(await sees(obecAdmin)).toBe(false)
    await expect(
      payload.findByID({ collection: 'events', id: eventId, user: stranger, overrideAccess: false }),
    ).rejects.toThrow()
    // Nor can the obec's admin edit or publish it.
    await expect(setDraft(eventId, false, obecAdmin)).rejects.toThrow()
  })

  it('takes no sign-ups and no invitations', async () => {
    await expect(
      payload.create({
        collection: 'registrations',
        data: { event: eventId, user: stranger.id, status: 'pending' },
        user: stranger,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'volunteer-invitations',
        data: { event: eventId, volunteer: stranger.id, kind: 'invitation' } as never,
        user: organizer,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/zveřejněná/) })
  })

  it('is everyone’s once published — and back to a draft while nobody is on it', async () => {
    await setDraft(eventId, false, organizer)
    expect(await sees(null)).toBe(true)
    expect(await sees(stranger)).toBe(true)
    await setDraft(eventId, true, organizer)
    expect(await sees(stranger)).toBe(false)
    await setDraft(eventId, false, organizer)
  })

  it('stays published once anyone signs up — cancelling is what remains', async () => {
    await payload.create({
      collection: 'registrations',
      data: { event: eventId, user: stranger.id, status: 'pending' },
      user: stranger,
      overrideAccess: false,
    })
    await expect(setDraft(eventId, true, organizer)).rejects.toMatchObject({ status: 409 })
    expect(await sees(null)).toBe(true)
  })

  it('a draft is deleted straight away by its creator; a published event has to be cancelled first', async () => {
    const draft = await createAs(organizer, true)
    await payload.delete({ collection: 'events', id: draft.id, user: organizer, overrideAccess: false })
    expect(await sees(null, draft.id)).toBe(false)
    const published = await createAs(organizer, false)
    await expect(
      payload.delete({ collection: 'events', id: published.id, user: organizer, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
