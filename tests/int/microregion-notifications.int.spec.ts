// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

// Captured, not sent — to check which admins get the e-mail and what it says.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
}))

import { enqueueEmail } from '@/lib/queue/queues'

// Whenever a mikroregion's membership changes, every obec it touches hears about it — in the app
// and by e-mail — with the obce it now shares with.

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

describe('Mikroregion: notifications to obec admins', () => {
  let a: { id: number; name: string }
  let b: { id: number; name: string }
  let c: { id: number; name: string }
  let superadmin: TestUser
  let adminA: TestUser
  let adminB: TestUser
  let adminC: TestUser
  /** Admin of A who switched e-mails off — in-app only. */
  let quietAdminA: TestUser
  let regionId: number
  const users: TestUser[] = []
  const REGION = `Notifregion ${STAMP}`

  const makeMuni = async (name: string) =>
    (await payload.create({
      collection: 'municipalities',
      data: {
        name: `Notif ${name} ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })) as { id: number; name: string }

  const makeUser = async (name: string, role: 'user' | 'admin' = 'user', notifyEmail = true) => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: `notifregion-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    await payload.create({
      collection: 'profiles',
      data: {
        user: user.id,
        fullName: `Notif ${name}`,
        municipality: a.id,
        notifyEmail,
        notifyInApp: true,
      },
      overrideAccess: true,
    })
    users.push(user)
    return user
  }

  const adminOf = async (name: string, municipality: { id: number }, notifyEmail = true) => {
    const user = await makeUser(name, 'user', notifyEmail)
    await payload.create({
      collection: 'user-roles',
      data: { user: user.id, municipality: municipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    return user
  }

  const inbox = async (user: TestUser) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { user: { equals: user.id } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs.map((n) => ({ title: n.title, message: n.message, link: n.link }))

  const mails = () =>
    vi
      .mocked(enqueueEmail)
      .mock.calls.map(([job]) => job as { to: string; subject: string; body: string })
  const mailTo = (user: TestUser) => mails().filter((m) => m.to === user.email)

  const clearInboxes = () =>
    payload.delete({
      collection: 'notifications',
      where: { user: { in: users.map((u) => u.id) } },
      overrideAccess: true,
    })

  const setMembers = (municipalities: number[]) =>
    payload.update({
      collection: 'microregions',
      id: regionId,
      data: { municipalities },
      user: superadmin,
      overrideAccess: false,
    })

  beforeAll(async () => {
    payload = await getPayload({ config })
    a = await makeMuni('A')
    b = await makeMuni('B')
    c = await makeMuni('C')
    superadmin = await makeUser('superadmin', 'admin')
    adminA = await adminOf('admin-a', a)
    quietAdminA = await adminOf('quiet-admin-a', a, false)
    adminB = await adminOf('admin-b', b)
    adminC = await adminOf('admin-c', c)
  })

  beforeEach(async () => {
    vi.mocked(enqueueEmail).mockClear()
    await clearInboxes()
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
    await clearInboxes().catch(() => {})
    await payload
      .delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true })
      .catch(() => {})
    for (const m of [a, b, c]) {
      await payload
        .delete({
          collection: 'organizations',
          where: { municipality: { equals: m.id } },
          overrideAccess: true,
        })
        .catch(() => {})
      await payload
        .delete({ collection: 'municipalities', id: m.id, overrideAccess: true })
        .catch(() => {})
    }
  })

  it('a new region: each obec hears it joined, and with whom it now shares', async () => {
    regionId = (
      await payload.create({
        collection: 'microregions',
        data: { name: REGION, municipalities: [a.id, b.id], mainMunicipality: a.id },
        user: superadmin,
        overrideAccess: false,
      })
    ).id

    const [toA] = await inbox(adminA)
    expect(toA).toEqual({
      title: `${a.name} je v mikroregionu ${REGION}`,
      message: `Správce Lonvity zařadil obec ${a.name} do mikroregionu ${REGION}. Akce, dobrovolníky a spolupořádání teď sdílíte s obcí ${b.name}.`,
      link: '/admin-obce',
    })
    const [toB] = await inbox(adminB)
    expect(toB.title).toBe(`${b.name} je v mikroregionu ${REGION}`)
    expect(toB.message).toContain(`s obcí ${a.name}.`)
    expect(await inbox(adminC)).toEqual([])

    expect(mailTo(adminA)).toHaveLength(1)
    expect(mailTo(adminA)[0].subject).toBe(toA.title)
    expect(mailTo(adminA)[0].body).toContain(`s obcí ${b.name}.`)
    expect(mailTo(adminA)[0].body).toContain('/admin-obce">Otevřít přehled obce</a>')
    expect(mailTo(adminB)).toHaveLength(1)
    expect(mailTo(adminC)).toHaveLength(0)
  })

  it("e-mail follows the admin's preference — the in-app one comes either way", async () => {
    await setMembers([a.id])
    expect(await inbox(quietAdminA)).toHaveLength(1)
    expect(mailTo(quietAdminA)).toHaveLength(0)
    expect(mailTo(adminA)).toHaveLength(1)
    await setMembers([a.id, b.id])
  })

  it('another obec joins: it hears it joined, the others hear who arrived', async () => {
    await setMembers([a.id, b.id, c.id])

    const [toC] = await inbox(adminC)
    expect(toC.title).toBe(`${c.name} je v mikroregionu ${REGION}`)
    expect(toC.message).toContain(`s obcemi ${a.name} a ${b.name}.`)

    const [toA] = await inbox(adminA)
    expect(toA).toEqual({
      title: `Změna v mikroregionu ${REGION}`,
      message: `Do mikroregionu ${REGION} přibyla obec ${c.name}. Akce, dobrovolníky a spolupořádání teď sdílíte s obcemi ${b.name} a ${c.name}.`,
      link: '/admin-obce',
    })
    const [toB] = await inbox(adminB)
    expect(toB.message).toContain(`přibyla obec ${c.name}`)
    expect(toB.message).toContain(`s obcemi ${a.name} a ${c.name}.`)

    for (const admin of [adminA, adminB, adminC]) expect(mailTo(admin)).toHaveLength(1)
  })

  it('an obec leaves: it hears it is out, the rest hear who left', async () => {
    await setMembers([a.id, c.id])

    const [toB] = await inbox(adminB)
    expect(toB).toEqual({
      title: `${b.name} už není v mikroregionu ${REGION}`,
      message: `Správce Lonvity vyřadil obec ${b.name} z mikroregionu ${REGION}. Akce, dobrovolníci i spolupořádání zůstávají zase jen v obci.`,
      link: '/admin-obce',
    })
    const [toA] = await inbox(adminA)
    expect(toA.message).toBe(
      `Do mikroregionu ${REGION} odešla obec ${b.name}. Akce, dobrovolníky a spolupořádání teď sdílíte s obcí ${c.name}.`,
    )
    const [toC] = await inbox(adminC)
    expect(toC.message).toContain(`odešla obec ${b.name}`)

    for (const admin of [adminA, adminB, adminC]) expect(mailTo(admin)).toHaveLength(1)
  })

  it('renaming or picking another main obec changes no membership — nobody is bothered', async () => {
    await payload.update({
      collection: 'microregions',
      id: regionId,
      data: { name: `${REGION} nový`, mainMunicipality: c.id },
      user: superadmin,
      overrideAccess: false,
    })
    for (const admin of [adminA, adminB, adminC]) expect(await inbox(admin)).toEqual([])
    expect(mails()).toHaveLength(0)
  })

  it('the region is removed: every obec still in it hears it stands alone again', async () => {
    await payload.delete({
      collection: 'microregions',
      id: regionId,
      user: superadmin,
      overrideAccess: false,
    })

    for (const [admin, muni] of [
      [adminA, a],
      [adminC, c],
    ] as const) {
      const [n] = await inbox(admin)
      expect(n.title).toBe(`${muni.name} už není v mikroregionu ${REGION} nový`)
      expect(mailTo(admin)).toHaveLength(1)
    }
    expect(await inbox(adminB)).toEqual([])
    expect(mailTo(adminB)).toHaveLength(0)
  })
})
