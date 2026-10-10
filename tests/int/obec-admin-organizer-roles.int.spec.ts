// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as previewOwnDeletion, POST as deleteOwnAccount } from '@/app/api/account/delete/route'

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

let obecA: { id: number }
let obecB: { id: number }
let adminA: TestUser
let organizerA: TestUser
let organizerB: TestUser
let participant: TestUser

const createUser = (name: string) =>
  payload.create({
    collection: 'users',
    data: { email: `roles-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
    overrideAccess: true,
  }) as Promise<TestUser>

const grant = (user: TestUser, municipality: { id: number }, role: 'organizer' | 'municipality_admin') =>
  payload.create({
    collection: 'user-roles',
    data: { user: user.id, municipality: municipality.id, role },
    overrideAccess: true,
  })

const organizerRolesIn = (municipality: { id: number }, as: TestUser) =>
  payload.find({
    collection: 'user-roles',
    where: { and: [{ municipality: { equals: municipality.id } }, { role: { equals: 'organizer' } }] },
    user: as,
    overrideAccess: false,
  })

describe("The obec's admin manages the obec's organizers (Administrace obce → Žádosti)", () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    obecA = await payload.create({
      collection: 'municipalities',
      data: { name: `Roles A ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5, lng: 15.9, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    obecB = await payload.create({
      collection: 'municipalities',
      data: { name: `Roles B ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.6, lng: 16.0, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    adminA = await createUser('admin-a')
    organizerA = await createUser('organizer-a')
    organizerB = await createUser('organizer-b')
    participant = await createUser('participant')
    await grant(adminA, obecA, 'municipality_admin')
    await grant(organizerA, obecA, 'organizer')
    await grant(organizerB, obecB, 'organizer')
  })

  afterAll(async () => {
    for (const user of [adminA, organizerA, organizerB, participant]) {
      await payload.delete({ collection: 'user-roles', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'organizations', where: { owner: { equals: user.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'profiles', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
    for (const obec of [obecA, obecB]) {
      await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true }).catch(() => {})
    }
  })

  it("lists the organizers of the obec they administer", async () => {
    const roles = await organizerRolesIn(obecA, adminA)
    expect(roles.docs.map((r) => (typeof r.user === 'object' ? r.user.id : r.user))).toEqual([organizerA.id])
  })

  it("doesn't list another obec's organizers", async () => {
    expect((await organizerRolesIn(obecB, adminA)).totalDocs).toBe(0)
  })

  it('a plain participant still only sees their own roles', async () => {
    expect((await organizerRolesIn(obecA, participant)).totalDocs).toBe(0)
    expect((await organizerRolesIn(obecA, organizerA)).totalDocs).toBe(1)
  })

  it("lets the obec's admin revoke an organizer role there", async () => {
    const [role] = (await organizerRolesIn(obecA, adminA)).docs
    await payload.delete({ collection: 'user-roles', id: role.id, user: adminA, overrideAccess: false })
    expect((await organizerRolesIn(obecA, adminA)).totalDocs).toBe(0)

    // …and the organizer hears about it.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const notices = await payload.find({
      collection: 'notifications',
      where: { and: [{ user: { equals: organizerA.id } }, { title: { equals: 'Role organizátora odebrána' } }] },
      overrideAccess: true,
    })
    expect(notices.totalDocs).toBe(1)
    await payload.delete({ collection: 'notifications', where: { user: { equals: organizerA.id } }, overrideAccess: true })
  })
})

describe('An obec is never left without its admin', () => {
  let obec: { id: number }
  let admin: TestUser
  let secondAdmin: TestUser
  let platformAdmin: TestUser

  const adminRolesOf = async (user: TestUser) =>
    (
      await payload.find({
        collection: 'user-roles',
        where: { and: [{ user: { equals: user.id } }, { role: { equals: 'municipality_admin' } }] },
        overrideAccess: true,
      })
    ).docs

  const asUser = async (user: TestUser, init?: RequestInit) => {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })
    return new Request('http://localhost/api/account/delete', {
      ...init,
      headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
    })
  }

  beforeAll(async () => {
    payload = payload ?? (await getPayload({ config: await config }))
    obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Sole Admin ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.7, lng: 16.1, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    admin = await createUser('sole-admin')
    secondAdmin = await createUser('second-admin')
    platformAdmin = (await payload.create({
      collection: 'users',
      data: { email: `roles-platform-${STAMP}@test.local`, password: 'test1234', role: 'admin' },
      overrideAccess: true,
    })) as TestUser
    await payload.create({ collection: 'profiles', data: { user: admin.id, fullName: 'Jediná Adminka' }, overrideAccess: true })
    await grant(admin, obec, 'municipality_admin')
  })

  afterAll(async () => {
    for (const user of [admin, secondAdmin, platformAdmin]) {
      await payload.delete({ collection: 'user-roles', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'profiles', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'organizations', where: { municipality: { equals: obec.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true }).catch(() => {})
  })

  it("the only admin can't remove their own role", async () => {
    const [role] = await adminRolesOf(admin)
    await expect(
      payload.delete({ collection: 'user-roles', id: role.id, user: admin, overrideAccess: false }),
    ).rejects.toThrow(/jediný admin/)
    expect(await adminRolesOf(admin)).toHaveLength(1)
  })

  it("the only admin can't delete their account — and is told why before trying", async () => {
    const preview = (await (await previewOwnDeletion(await asUser(admin))).json()) as {
      soleAdminOf: { id: string; name: string }[]
    }
    expect(preview.soleAdminOf).toEqual([{ id: String(obec.id), name: `Sole Admin ${STAMP}` }])

    const response = await deleteOwnAccount(await asUser(admin, { method: 'POST', body: JSON.stringify({ confirm: 'SMAZAT' }) }))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/jediný admin/)
  })

  it('with a second admin, either may step down', async () => {
    await grant(secondAdmin, obec, 'municipality_admin')
    const [role] = await adminRolesOf(admin)
    await payload.delete({ collection: 'user-roles', id: role.id, user: admin, overrideAccess: false })
    expect(await adminRolesOf(admin)).toHaveLength(0)
  })

  it('a platform admin may still take the last admin role away — the obec is then theirs to look after', async () => {
    const [role] = await adminRolesOf(secondAdmin)
    await payload.delete({ collection: 'user-roles', id: role.id, user: platformAdmin, overrideAccess: false })
    expect(await adminRolesOf(secondAdmin)).toHaveLength(0)
  })

  it("an obec without an admin sends what waits on it to the platform admins' panel", async () => {
    const applicant = await createUser('applicant')
    await payload.create({
      collection: 'organizer-requests',
      data: {
        user: applicant.id,
        municipality: obec.id,
        reason: 'Vedu místní spolek a chci tu pořádat akce pro seniory.',
        organizationName: 'Spolek seniorů',
        organizationType: 'association',
      },
      overrideAccess: true,
    })
    // The notification is fire-and-forget — give it a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const notices = await payload.find({
      collection: 'notifications',
      where: { and: [{ user: { equals: platformAdmin.id } }, { title: { equals: 'Nová žádost o roli organizátora' } }] },
      overrideAccess: true,
    })
    expect(notices.docs[0]?.link).toBe('/superadmin?tab=requests')

    await payload.delete({ collection: 'notifications', where: { user: { equals: platformAdmin.id } }, overrideAccess: true })
    await payload.delete({ collection: 'organizer-requests', where: { user: { equals: applicant.id } }, overrideAccess: true })
    await payload.delete({ collection: 'users', id: applicant.id, overrideAccess: true })
  })
})

describe('Asking for the organizer role', () => {
  let obec: { id: number }
  let applicant: TestUser
  let other: TestUser

  const ask = (user: TestUser) =>
    payload.create({
      collection: 'organizer-requests',
      data: {
        user: user.id,
        municipality: obec.id,
        reason: 'Provozuji tu kavárnu a chci pořádat komunitní večery.',
        organizationName: 'Kavárna',
        organizationType: 'business',
      },
      user,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = payload ?? (await getPayload({ config: await config }))
    obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Requests ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.8, lng: 16.2, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    applicant = await createUser('request-applicant')
    other = await createUser('request-other')
  })

  afterAll(async () => {
    for (const user of [applicant, other]) {
      await payload.delete({ collection: 'organizer-requests', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true }).catch(() => {})
  })

  it('a second request while one waits is a plain Czech 400, not a 500', async () => {
    await ask(applicant)
    await expect(ask(applicant)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/už čeká/) })
  })

  it('the applicant can withdraw their waiting request — nobody else can', async () => {
    const [request] = (
      await payload.find({ collection: 'organizer-requests', where: { user: { equals: applicant.id } }, overrideAccess: true })
    ).docs
    await expect(
      payload.delete({ collection: 'organizer-requests', id: request.id, user: other, overrideAccess: false }),
    ).rejects.toThrow()
    await payload.delete({ collection: 'organizer-requests', id: request.id, user: applicant, overrideAccess: false })
    expect(
      (await payload.count({ collection: 'organizer-requests', where: { user: { equals: applicant.id } }, overrideAccess: true })).totalDocs,
    ).toBe(0)
  })
})
