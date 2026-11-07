// @vitest-environment node

import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { namesRowsOnly } from '@/collections/Media'
import { isInAppLink } from '@/collections/Notifications'
import { removeAnonymizedFiles } from '@/collections/shared/anonymizeUser'
import { isAllowedByRobots, matchesRobotsPattern, parseRobots } from '@/lib/import/fetch'

// Regressions for the findings of security audit run-3. Access is exercised for real
// (overrideAccess: false with a user), not through the Local API's default bypass.

let payload: Payload
const STAMP = Date.now()

type TestUser = { id: number; email: string; role: 'admin' | 'user' }

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

describe('Security audit run-3 regressions', () => {
  let muni: { id: number }
  let cat: { id: number }
  let organizer: TestUser
  let alice: TestUser
  let mallory: TestUser
  let event: { id: number }
  const userIds: number[] = []
  const mediaIds: number[] = []
  const eventIds: number[] = []

  const makeUser = async (name: string): Promise<TestUser> => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `run3-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    userIds.push(user.id)
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `run3 ${name}`, municipality: muni.id, notifyEmail: false },
      overrideAccess: true,
    })
    return user as TestUser
  }

  const uploadMedia = async (alt: string) => {
    const media = await payload.create({
      collection: 'media',
      data: { alt },
      file: { data: PNG, mimetype: 'image/png', name: `run3-${alt}-${STAMP}.png`, size: PNG.length },
      overrideAccess: true,
    })
    mediaIds.push(media.id)
    return media
  }

  const mediaExists = async (id: number) =>
    Boolean(await payload.findByID({ collection: 'media', id, overrideAccess: true }).catch(() => null))

  const profileOf = async (userId: number) =>
    (await payload.find({ collection: 'profiles', where: { user: { equals: userId } }, depth: 0, limit: 1, overrideAccess: true }))
      .docs[0]

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Run3 Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    cat = await payload.create({ collection: 'event-categories', data: { name: `Test Run3 Cat ${STAMP}` }, overrideAccess: true })
    organizer = await makeUser('organizer')
    alice = await makeUser('alice')
    mallory = await makeUser('mallory')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: muni.id, role: 'organizer' },
      overrideAccess: true,
    })
    event = await payload.create({
      collection: 'events',
      data: {
        title: `Run3 Event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
      },
      overrideAccess: true,
    })
    eventIds.push(event.id)
  })

  afterAll(async () => {
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'audit-log', where: { actor: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'media', where: { id: { in: mediaIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }).catch(() => {})
  })

  describe('N1 — users.email / users.role are no oracle through a relationship', () => {
    it.each([
      ['organizer.email', { like: 'run3' }],
      ['organizer.role', { equals: 'user' }],
      ['coOrganizers.email', { like: 'run3' }],
    ])('a signed-in user cannot filter events by %s', async (path, condition) => {
      await expect(
        payload.find({ collection: 'events', where: { [path]: condition }, user: mallory, overrideAccess: false }),
      ).rejects.toThrow()
    })

    it('nor organizations by their owner', async () => {
      await expect(
        payload.find({ collection: 'organizations', where: { 'owner.email': { like: 'run3' } }, user: mallory, overrideAccess: false }),
      ).rejects.toThrow()
    })

    it('still reads its own e-mail and role', async () => {
      const me = await payload.findByID({ collection: 'users', id: mallory.id, user: mallory, overrideAccess: false })
      expect(me.email).toBe(mallory.email)
      expect(me.role).toBe('user')
    })

    it('a superadmin still filters by them', async () => {
      const admin = { ...mallory, role: 'admin' as const }
      const found = await payload.find({
        collection: 'events',
        where: { 'organizer.email': { equals: organizer.email } },
        user: admin,
        overrideAccess: false,
      })
      expect(found.docs.map((d) => d.id)).toContain(event.id)
    })
  })

  describe('N2 — cleanup never deletes an upload somebody else still shows', () => {
    it("an account pointing its avatar at someone's photo and deleting itself leaves the photo", async () => {
      const alicePhoto = await uploadMedia('alice-photo')
      await payload.update({ collection: 'profiles', id: (await profileOf(alice.id))!.id, data: { avatar: alicePhoto.id }, overrideAccess: true })

      // What anonymizeUser hands over for mallory, whose avatar pointed at alice's upload.
      await removeAnonymizedFiles(payload, mallory.id, { mediaIds: [alicePhoto.id], exportIds: [] })
      expect(await mediaExists(alicePhoto.id)).toBe(true)
    })

    it("a deleted event takes its cover along, but not someone's avatar used as one", async () => {
      const bobPhoto = await uploadMedia('used-as-avatar')
      await payload.update({ collection: 'profiles', id: (await profileOf(organizer.id))!.id, data: { avatar: bobPhoto.id }, overrideAccess: true })
      const ownCover = await uploadMedia('own-cover')
      const make = (image: number) =>
        payload.create({
          collection: 'events',
          data: {
            title: `Run3 Draft ${STAMP}`,
            dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            locationText: 'Test location',
            lat: 49.5661,
            lng: 15.9403,
            capacity: 10,
            organizer: organizer.id,
            categories: [cat.id],
            municipality: muni.id,
            status: 'active',
            isPaid: false,
            image,
          },
          overrideAccess: true,
        })
      const borrowing = await make(bobPhoto.id)
      const owning = await make(ownCover.id)
      await payload.delete({ collection: 'events', id: borrowing.id, overrideAccess: true })
      await payload.delete({ collection: 'events', id: owning.id, overrideAccess: true })

      expect(await mediaExists(bobPhoto.id)).toBe(true)
      expect(await mediaExists(ownCover.id)).toBe(false)
    })

    it('an upload nobody shows is still removed', async () => {
      const orphan = await uploadMedia('orphan')
      await removeAnonymizedFiles(payload, mallory.id, { mediaIds: [orphan.id], exportIds: [] })
      expect(await mediaExists(orphan.id)).toBe(false)
    })
  })

  describe('N3 — media are looked up by id, never listed', () => {
    it('accepts id equals and a bounded id in', () => {
      expect(namesRowsOnly({ id: { equals: '5' } })).toBe(true)
      expect(namesRowsOnly({ id: { in: ['1', '2'] } })).toBe(true)
      expect(namesRowsOnly({ id: { in: '1,2' } })).toBe(true)
      expect(namesRowsOnly({ id: { in: { 0: '1', 1: '2' } } })).toBe(true)
    })

    it('refuses everything that would list the collection', () => {
      expect(namesRowsOnly(undefined)).toBe(false)
      expect(namesRowsOnly({ id: { exists: 'true' } })).toBe(false)
      expect(namesRowsOnly({ id: { greater_than: '0' } })).toBe(false)
      expect(namesRowsOnly({ id: { equals: '1', exists: 'true' } })).toBe(false)
      expect(namesRowsOnly({ id: { equals: '1' }, alt: { like: 'Jan' } })).toBe(false)
      expect(namesRowsOnly({ or: [{ id: { exists: true } }] })).toBe(false)
      expect(namesRowsOnly({ id: { in: Array.from({ length: 501 }, (_, i) => String(i)) } })).toBe(false)
    })
  })

  describe('N4 — a notification stays with its recipient and says what the server wrote', () => {
    it('the recipient may mark it read, but not hand it over, reword it or relink it', async () => {
      const notification = await payload.create({
        collection: 'notifications',
        data: { user: mallory.id, title: 'Původní', message: 'Původní zpráva', link: `/akce/${event.id}` },
        overrideAccess: true,
      })
      const readAt = new Date().toISOString()
      await payload.update({
        collection: 'notifications',
        id: notification.id,
        data: { user: alice.id, title: 'Podvrh', message: 'Klikněte', link: '/profil', readAt },
        user: mallory,
        overrideAccess: false,
      })
      const after = await payload.findByID({ collection: 'notifications', id: notification.id, depth: 0, overrideAccess: true })
      expect(after.user).toBe(mallory.id)
      expect(after.title).toBe('Původní')
      expect(after.message).toBe('Původní zpráva')
      expect(after.link).toBe(`/akce/${event.id}`)
      expect(after.readAt).toBeTruthy()
    })

    it('a link is a path inside the app', async () => {
      expect(isInAppLink('/akce/1')).toBe(true)
      expect(isInAppLink('/api/exports/1/download')).toBe(true)
      expect(isInAppLink('https://evil.test')).toBe(false)
      expect(isInAppLink('//evil.test')).toBe(false)
      expect(isInAppLink('/\\evil.test')).toBe(false)
      expect(isInAppLink('javascript:alert(1)')).toBe(false)
      await expect(
        payload.create({
          collection: 'notifications',
          data: { user: mallory.id, title: 'x', message: 'x', link: 'https://evil.test' },
          overrideAccess: true,
        }),
      ).rejects.toThrow()
    })
  })

  describe('N6 — robots.txt matching runs in bounded time', () => {
    it('keeps the RFC 9309 semantics', () => {
      expect(matchesRobotsPattern('/admin', '/admin/x')).toBe(true)
      expect(matchesRobotsPattern('/admin', '/adm')).toBe(false)
      expect(matchesRobotsPattern('/*.pdf$', '/a/b.pdf')).toBe(true)
      expect(matchesRobotsPattern('/*.pdf$', '/a/b.pdf?x=1')).toBe(false)
      expect(matchesRobotsPattern('/a*b*c', '/a__b__c__')).toBe(true)
      expect(matchesRobotsPattern('/a*b*c', '/a__c__b')).toBe(false)
      expect(matchesRobotsPattern('/x$y', '/x$y/z')).toBe(true)
      expect(matchesRobotsPattern('*', '/')).toBe(true)
    })

    it('a hostile pattern against a long path no longer freezes the worker', () => {
      const rules = parseRobots(`User-agent: *\nDisallow: /${'a*'.repeat(30)}b`)
      const started = performance.now()
      expect(isAllowedByRobots(rules, `/${'a'.repeat(5000)}`)).toBe(true)
      expect(performance.now() - started).toBeLessThan(200)
    })

    it('a robots.txt too large to evaluate keeps us out', () => {
      const many = Array.from({ length: 501 }, (_, i) => `Disallow: /p${i}`).join('\n')
      expect(isAllowedByRobots(parseRobots(`User-agent: *\n${many}`), '/kalendar')).toBe(false)
      expect(isAllowedByRobots(parseRobots(`User-agent: *\nDisallow: /${'x'.repeat(300)}`), '/kalendar')).toBe(false)
    })
  })
})
