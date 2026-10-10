import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// An obec's admin invites a resident into the volunteer pool. Joining stays their own consent:
// they accept by joining, or decline; the admin may withdraw one still waiting.

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

describe('Invitations into the volunteer pool', () => {
  let muni: { id: number }
  let otherMuni: { id: number }
  let admin: TestUser
  let otherAdmin: TestUser
  let resident: TestUser
  let neighbour: TestUser
  let outsider: TestUser
  const users: TestUser[] = []
  const profileOf = new Map<number, number>()

  const makeUser = async (name: string, home: { id: number }) => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `pool-inv-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as TestUser
    const profile = await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Pool ${name}`, municipality: home.id, notifyEmail: false },
      overrideAccess: true,
    })
    profileOf.set(user.id, profile.id)
    users.push(user)
    return user
  }

  const invite = (as: TestUser, who: TestUser, municipality = muni, message = 'Hledáme řidiče.') =>
    payload.create({
      collection: 'pool-invitations',
      data: { user: who.id, municipality: municipality.id, message } as never,
      user: as,
      overrideAccess: false,
    })

  const answer = (as: TestUser, id: number, status: 'declined' | 'withdrawn' | 'accepted') =>
    payload.update({ collection: 'pool-invitations', id, data: { status }, user: as, overrideAccess: false })

  const noticesFor = async (user: TestUser, title: string) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { user: { equals: user.id }, title: { equals: title } },
        overrideAccess: true,
      })
    ).totalDocs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const makeMuni = (name: string) =>
      payload.create({
        collection: 'municipalities',
        data: { name: `Pool Inv ${name} ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
        overrideAccess: true,
      })
    muni = await makeMuni('A')
    otherMuni = await makeMuni('B')
    admin = await makeUser('admin', muni)
    otherAdmin = await makeUser('other-admin', otherMuni)
    resident = await makeUser('resident', muni)
    neighbour = await makeUser('neighbour', muni)
    outsider = await makeUser('outsider', otherMuni)
    await payload.create({ collection: 'user-roles', data: { user: admin.id, municipality: muni.id, role: 'municipality_admin' }, overrideAccess: true })
    await payload.create({ collection: 'user-roles', data: { user: otherAdmin.id, municipality: otherMuni.id, role: 'municipality_admin' }, overrideAccess: true })
  })

  afterAll(async () => {
    const userIds = users.map((u) => u.id)
    await payload.delete({ collection: 'pool-invitations', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    for (const m of [muni, otherMuni]) await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
  })

  it("is the obec admin's to send — to their own residents only, and once at a time", async () => {
    await expect(invite(otherAdmin, resident)).rejects.toThrow()
    await expect(invite(neighbour, resident)).rejects.toThrow()
    await expect(invite(admin, outsider)).rejects.toMatchObject({ status: 400 })

    const invitation = await invite(admin, resident)
    expect(invitation.status).toBe('pending')
    expect(await noticesFor(resident, 'Pozvánka do poolu dobrovolníků')).toBe(1)
    await expect(invite(admin, resident)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/čeká/) })
  })

  it("doesn't put anyone into the pool — they accept by joining it themselves", async () => {
    const [invitation] = (
      await payload.find({ collection: 'pool-invitations', where: { user: { equals: resident.id } }, overrideAccess: true })
    ).docs
    await expect(answer(resident, invitation.id, 'accepted')).rejects.toMatchObject({ status: 400 })
    const profile = await payload.findByID({ collection: 'profiles', id: profileOf.get(resident.id)!, overrideAccess: true })
    expect(profile.isVolunteer).toBe(false)

    await payload.update({
      collection: 'profiles',
      id: profileOf.get(resident.id)!,
      data: {
        isVolunteer: true,
        volunteerMunicipality: muni.id,
        volunteerFocus: ['doprava'],
        volunteerAllowEmail: true,
        volunteerContactEmail: resident.email,
      },
      user: resident,
      overrideAccess: false,
    })
    const after = await payload.findByID({ collection: 'pool-invitations', id: invitation.id, overrideAccess: true })
    expect(after.status).toBe('accepted')
    expect(await noticesFor(admin, 'Nový dobrovolník v poolu')).toBe(1)
    // Already in the pool — nothing more to ask.
    await expect(invite(admin, resident)).rejects.toMatchObject({ status: 400 })
  })

  it('the invited person may decline — then the obec waits before asking again', async () => {
    const invitation = await invite(admin, neighbour)
    await expect(answer(admin, invitation.id, 'declined')).rejects.toMatchObject({ status: 403 })
    expect((await answer(neighbour, invitation.id, 'declined')).status).toBe('declined')
    expect(await noticesFor(admin, 'Pozvánka do poolu odmítnuta')).toBe(1)
    await expect(invite(admin, neighbour)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/odmítl/) })
  })

  it('the obec withdraws one still waiting; nobody else does, and a decided one stays', async () => {
    await payload.delete({ collection: 'pool-invitations', where: { user: { equals: neighbour.id } }, overrideAccess: true })
    const invitation = await invite(admin, neighbour)
    await expect(answer(otherAdmin, invitation.id, 'withdrawn')).rejects.toThrow()
    await expect(answer(neighbour, invitation.id, 'withdrawn')).rejects.toMatchObject({ status: 403 })
    expect((await answer(admin, invitation.id, 'withdrawn')).status).toBe('withdrawn')
    await expect(answer(neighbour, invitation.id, 'declined')).rejects.toMatchObject({ status: 409 })
  })

  it('is read only by the invited person and the obec', async () => {
    const visibleTo = async (viewer: TestUser) =>
      (await payload.find({ collection: 'pool-invitations', where: { user: { equals: neighbour.id } }, user: viewer, overrideAccess: false }))
        .totalDocs
    expect(await visibleTo(neighbour)).toBeGreaterThan(0)
    expect(await visibleTo(admin)).toBeGreaterThan(0)
    expect(await visibleTo(otherAdmin)).toBe(0)
    expect(await visibleTo(resident)).toBe(0)
  })
})
