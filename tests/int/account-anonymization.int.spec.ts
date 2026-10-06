// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as previewOwnDeletion, POST as deleteOwnAccount } from '@/app/api/account/delete/route'
import { POST as anonymizeAsSuperadmin } from '@/app/api/superadmin/users/[id]/anonymize/route'
import { loadMunicipalityExportData } from '@/lib/exports/load'
import { summarizeOrganizationFeedback } from '@/lib/organization-feedback'
import { computeReportMetrics } from '@/lib/report'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type TestUser = { id: number; email: string; role: string }

const relId = (value: unknown): number | null =>
  value == null ? null : typeof value === 'object' ? (value as { id: number }).id : (value as number)

describe('Deleting an account keeps its data, anonymized, for the obec and organizers', () => {
  let muni: { id: number }
  let cat: { id: number }
  let superadmin: TestUser
  let pub: TestUser
  let pubOrganizationId: number
  let jana: TestUser
  let janaToken: string
  let pastEvent: { id: number }
  let futureEvent: { id: number }
  let volunteerEvent: { id: number }
  let pastRegistration: { id: number }
  let futureRegistration: { id: number }
  const userIds: number[] = []
  const eventIds: number[] = []

  const makeUser = async (
    name: string,
    role: 'organizer' | 'participant' | 'municipality_admin' | null,
    profile: Record<string, unknown> = {},
    platformRole: 'user' | 'admin' = 'user',
  ): Promise<TestUser> => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `anon-${name}-${STAMP}@test.local`, password: 'test1234', role: platformRole },
      overrideAccess: true,
    })
    userIds.push(user.id)
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Anon ${name}`, municipality: muni.id, notifyEmail: false, ...profile },
      overrideAccess: true,
    })
    if (role) {
      await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
    }
    return user
  }

  const tokenOf = async (user: TestUser): Promise<string> =>
    (await payload.login({ collection: 'users', data: { email: user.email, password: 'test1234' } })).token!

  const organizationOf = async (user: TestUser) =>
    (
      await payload.find({
        collection: 'organizations',
        where: { owner: { equals: user.id } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]

  /** An event that already happened — a trusted write, since a past start can't be created through the app. */
  const pastEventBy = async (organizer: TestUser, title: string, daysAgo = 10) => {
    const organization = await organizationOf(organizer)
    const event = await payload.db.create({
      collection: 'events',
      data: {
        title: `${title} ${STAMP}`,
        dateTime: new Date(Date.now() - daysAgo * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 20,
        organizer: organizer.id,
        organization: organization?.id ?? null,
        categories: [cat.id],
        municipality: muni.id,
        status: 'finished',
        isPaid: false,
        registrationApprovalMode: 'manual',
        coOrganizations: [],
        coOrganizers: [],
      },
    })
    eventIds.push(event.id)
    return event
  }

  const futureEventBy = async (organizer: TestUser, title: string) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `${title} ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 20,
        organizer: organizer.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    eventIds.push(event.id)
    return event
  }

  const authHeaders = async (user: TestUser) => ({ Authorization: `JWT ${await tokenOf(user)}` })

  const deleteOwn = async (user: TestUser, body: unknown = { confirm: 'SMAZAT' }) =>
    deleteOwnAccount(
      new Request('http://localhost/api/account/delete', {
        method: 'POST',
        headers: { ...(await authHeaders(user)), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

  const anonymizeAs = async (actor: TestUser, target: TestUser) =>
    anonymizeAsSuperadmin(
      new Request(`http://localhost/api/superadmin/users/${target.id}/anonymize`, {
        method: 'POST',
        headers: await authHeaders(actor),
      }),
      { params: Promise.resolve({ id: String(target.id) }) },
    )

  const obecMetrics = async () => {
    const data = await loadMunicipalityExportData(payload, String(muni.id))
    return computeReportMetrics(data.events, data.registrations, data.profiles)
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Anon Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403 },
      overrideAccess: true,
    })
    cat = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Anon ${STAMP}` },
      overrideAccess: true,
    })

    superadmin = await makeUser('superadmin', null, {}, 'admin')
    pub = await makeUser('hospoda', 'organizer')
    pubOrganizationId = (await organizationOf(pub))!.id
    jana = await makeUser('jana', 'participant', {
      fullName: 'Jana Nováková',
      phone: '+420 777 123 456',
      dateOfBirth: '1950-03-01T00:00:00.000Z',
      gender: 'zena',
      isVolunteer: true,
      volunteerMunicipality: muni.id,
      volunteerFocus: ['akce'],
      volunteerNote: 'Ráda pomůžu s kavárnou.',
      volunteerAllowEmail: true,
      volunteerContactEmail: `jana-contact-${STAMP}@test.local`,
    })

    // Jana came to a past event and rated it, helped on another as a volunteer (and was rated),
    // and is signed up for one ahead.
    pastEvent = await pastEventBy(pub, 'Past event')
    pastRegistration = await payload.create({
      collection: 'registrations',
      data: { event: pastEvent.id, user: jana.id, status: 'approved', attendanceStatus: 'attended', attendanceNote: 'Přišla s vnučkou' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    await payload.create({
      collection: 'event-feedback',
      data: {
        registration: pastRegistration.id,
        satisfactionRating: 5,
        feltWelcomeRating: 4,
        metSomeoneNew: true,
        cameAlone: false,
        comment: 'Jsem Jana z Horní ulice, bylo to krásné.',
      },
      overrideAccess: true,
    })
    volunteerEvent = await pastEventBy(pub, 'Volunteer event', 5)
    const volunteerRegistration = await payload.create({
      collection: 'registrations',
      data: { event: volunteerEvent.id, user: jana.id, role: 'volunteer', status: 'approved', attendanceStatus: 'attended' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    await payload.create({
      collection: 'volunteer-ratings',
      data: { registration: volunteerRegistration.id, rating: 5, comment: 'Jana je skvělá.' } as never,
      user: pub,
      overrideAccess: false,
    })
    futureEvent = await futureEventBy(pub, 'Future event')
    futureRegistration = await payload.create({
      collection: 'registrations',
      data: { event: futureEvent.id, user: jana.id, status: 'approved' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })

    await payload.create({
      collection: 'organizer-requests',
      data: {
        user: jana.id,
        municipality: muni.id,
        reason: 'Vedu kroužek pletení v Horní ulici.',
        organizationName: 'Pletení u Jany',
        organizationType: 'individual',
        status: 'rejected',
      },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'consents',
      data: { user: jana.id, type: 'platform_terms', version: '1', grantedAt: new Date().toISOString() },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'auth-identities',
      data: { user: jana.id, provider: 'google', providerSubject: `anon-google-${STAMP}`, providerType: 'social' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'notifications',
      data: { user: jana.id, title: 'Test', message: 'Test' },
      overrideAccess: true,
    })
    janaToken = await tokenOf(jana)
  })

  afterAll(async () => {
    await payload.delete({ collection: 'event-feedback', where: { 'registration.event': { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'volunteer-ratings', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizer-requests', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  describe('a participant deleting their own account', () => {
    let metricsBefore: Awaited<ReturnType<typeof obecMetrics>>
    let feedbackBefore: Awaited<ReturnType<typeof summarizeOrganizationFeedback>>

    beforeAll(async () => {
      metricsBefore = await obecMetrics()
      feedbackBefore = await summarizeOrganizationFeedback(payload, pubOrganizationId)
    })

    it('needs the confirmation word', async () => {
      const response = await deleteOwn(jana, {})
      expect(response.status).toBe(400)
    })

    it('a participant has nothing standing in the way', async () => {
      const response = await previewOwnDeletion(
        new Request('http://localhost/api/account/delete', { headers: await authHeaders(jana) }),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ blockingEvents: [] })
    })

    it('deletes the account and signs them out', async () => {
      const response = await deleteOwn(jana)
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toMatch(/payload-token=;/)
    })

    it('they cannot sign in again — not with the password, not with an old token or cookie', async () => {
      await expect(tokenOf(jana)).rejects.toThrow()
      const viaHeader = await payload.auth({ headers: new Headers({ Authorization: `JWT ${janaToken}` }) })
      expect(viaHeader.user).toBeNull()
      const viaCookie = await payload.auth({ headers: new Headers({ cookie: `payload-token=${janaToken}` }) })
      expect(viaCookie.user).toBeNull()
    })

    it('nothing on the account or profile points at the person any more', async () => {
      const user = await payload.findByID({ collection: 'users', id: jana.id, overrideAccess: true })
      expect(user.email).not.toContain('jana')
      expect(user.email).toMatch(/@anonymized\.invalid$/)
      expect(user.anonymizedAt).toBeTruthy()

      const profile = (
        await payload.find({ collection: 'profiles', where: { user: { equals: jana.id } }, overrideAccess: true })
      ).docs[0]
      expect(profile).toMatchObject({
        fullName: 'Anonymní uživatel',
        phone: null,
        dateOfBirth: null,
        gender: null,
        isVolunteer: false,
        volunteerNote: null,
        volunteerContactEmail: null,
        over50: true,
      })
      // What the obec's overview still needs.
      expect(relId(profile.municipality)).toBe(muni.id)
      expect(profile.deletedAt ?? null).toBeNull()
    })

    it('their history stays, without the words they wrote', async () => {
      const past = await payload.findByID({ collection: 'registrations', id: pastRegistration.id, overrideAccess: true })
      expect(past).toMatchObject({ status: 'approved', attendanceStatus: 'attended', attendanceNote: null })

      const feedback = (
        await payload.find({
          collection: 'event-feedback',
          where: { registration: { equals: pastRegistration.id } },
          overrideAccess: true,
        })
      ).docs[0]
      expect(feedback).toMatchObject({ satisfactionRating: 5, feltWelcomeRating: 4, comment: null })

      const request = (
        await payload.find({ collection: 'organizer-requests', where: { user: { equals: jana.id } }, overrideAccess: true })
      ).docs[0]
      expect(request.reason).toBeFalsy()
    })

    it('the event ahead loses them — its organizer told without their name', async () => {
      const future = await payload.findByID({ collection: 'registrations', id: futureRegistration.id, overrideAccess: true })
      expect(future.status).toBe('cancelled')

      const notifications = await payload.find({
        collection: 'notifications',
        where: { user: { equals: pub.id } },
        sort: '-createdAt',
        overrideAccess: true,
      })
      const told = notifications.docs.find((n) => n.message.includes(`Future event ${STAMP}`))
      expect(told?.message).toContain('smazal')
      expect(told?.message).not.toContain('Jana')
    })

    it('what only described them goes: sign-in identities, consents, notifications, ratings as a volunteer', async () => {
      const count = async (collection: 'auth-identities' | 'consents' | 'notifications' | 'volunteer-ratings', field: string) =>
        (await payload.count({ collection, where: { [field]: { equals: jana.id } }, overrideAccess: true })).totalDocs
      expect(await count('auth-identities', 'user')).toBe(0)
      expect(await count('consents', 'user')).toBe(0)
      expect(await count('notifications', 'user')).toBe(0)
      expect(await count('volunteer-ratings', 'volunteer')).toBe(0)
    })

    it("the obec's overview and the organization's ratings come out the same", async () => {
      expect(await obecMetrics()).toEqual(metricsBefore)
      expect(await summarizeOrganizationFeedback(payload, pubOrganizationId)).toEqual(feedbackBefore)
    })

    it('it happens once', async () => {
      expect((await anonymizeAs(superadmin, jana)).status).toBe(409)
    })
  })

  describe('an organizer', () => {
    it('cannot delete the account while running an event ahead — and is told which', async () => {
      const preview = await previewOwnDeletion(
        new Request('http://localhost/api/account/delete', { headers: await authHeaders(pub) }),
      )
      const { blockingEvents } = (await preview.json()) as { blockingEvents: { id: string; title: string }[] }
      expect(blockingEvents).toEqual([expect.objectContaining({ id: String(futureEvent.id), title: `Future event ${STAMP}` })])

      const response = await deleteOwn(pub)
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/Future event/)
      const user = await payload.findByID({ collection: 'users', id: pub.id, overrideAccess: true })
      expect(user.anonymizedAt ?? null).toBeNull()
    })

    it('with only past events: the events stay, the organization is hidden and loses the name, the role goes', async () => {
      const former = await makeUser('former', 'organizer')
      const organization = (await organizationOf(former))!
      const event = await pastEventBy(former, 'Former organizer event')

      expect((await deleteOwn(former)).status).toBe(200)

      const kept = await payload.findByID({ collection: 'events', id: event.id, overrideAccess: true })
      expect(relId(kept.organizer)).toBe(former.id)
      const hidden = await payload.findByID({ collection: 'organizations', id: organization.id, overrideAccess: true })
      expect(hidden.deletedAt).toBeTruthy()
      expect(hidden.name).toBe('Bývalý pořadatel')
      expect(
        (await payload.count({ collection: 'user-roles', where: { user: { equals: former.id } }, overrideAccess: true })).totalDocs,
      ).toBe(0)
    })

    it("a business or club keeps its name — it isn't the person's", async () => {
      const cafe = await makeUser('kavarna', 'organizer')
      const organization = (await organizationOf(cafe))!
      await payload.db.updateOne({
        collection: 'organizations',
        id: organization.id,
        data: { type: 'business', name: `Kavárna Anon ${STAMP}` },
      })

      expect((await deleteOwn(cafe)).status).toBe(200)

      const hidden = await payload.findByID({ collection: 'organizations', id: organization.id, overrideAccess: true })
      expect(hidden.deletedAt).toBeTruthy()
      expect(hidden.name).toBe(`Kavárna Anon ${STAMP}`)
    })
  })

  describe('an obec admin', () => {
    it('loses the role, and the obec no longer names them its admin', async () => {
      const admin = await makeUser('obec', 'municipality_admin')
      expect(relId((await payload.findByID({ collection: 'municipalities', id: muni.id, overrideAccess: true })).adminUser)).toBe(
        admin.id,
      )

      expect((await deleteOwn(admin)).status).toBe(200)

      const municipality = await payload.findByID({ collection: 'municipalities', id: muni.id, overrideAccess: true })
      expect(relId(municipality.adminUser)).not.toBe(admin.id)
    })
  })

  describe('the superadmin', () => {
    it('anonymizes an account from the panel instead of deleting it', async () => {
      const panelUser = await makeUser('panel', 'participant')
      const response = await anonymizeAs(superadmin, panelUser)
      expect(response.status).toBe(200)
      const user = await payload.findByID({ collection: 'users', id: panelUser.id, overrideAccess: true })
      expect(user.anonymizedAt).toBeTruthy()
    })

    it('nobody else may', async () => {
      const someone = await makeUser('someone', 'participant')
      expect((await anonymizeAs(pub, someone)).status).toBe(403)
    })

    it('a platform admin account cannot be deleted through the app — not even their own', async () => {
      expect((await deleteOwn(superadmin)).status).toBe(403)
      expect((await anonymizeAs(superadmin, superadmin)).status).toBe(403)
    })

    it('the hard delete over the API is closed', async () => {
      const someone = await makeUser('hard-delete', 'participant')
      await expect(
        payload.delete({ collection: 'users', id: someone.id, user: superadmin, overrideAccess: false }),
      ).rejects.toThrow()
    })
  })
})
