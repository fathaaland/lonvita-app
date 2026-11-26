import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET } from '@/app/api/events/upcoming/route'

// The home page's listing (GET /api/events/upcoming) — cached on the CDN for everybody, so it must
// only ever hold what a signed-out visitor may see: published, upcoming, not cancelled events.

let payload: Payload

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

describe('The upcoming-events listing (GET /api/events/upcoming)', () => {
  let muni: { id: number }
  let otherMuni: { id: number }
  let category: { id: number }
  let organizer: { id: number }
  const ids: Record<string, number> = {}

  const makeEvent = async (name: string, data: Record<string, unknown>) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Upcoming ${STAMP} ${name}`,
        dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        municipality: muni.id,
        categories: [category.id],
        isPaid: false,
        registrationApprovalMode: 'auto',
        ...data,
      } as never,
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    ids[name] = event.id as number
  }

  const list = async (query = '') => {
    const res = await GET(new Request(`http://localhost/api/events/upcoming${query}`))
    const body = (await res.json()) as { docs: { id: number }[] }
    return { res, ids: body.docs.map((d) => d.id) }
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const makeMuni = (name: string) =>
      payload.create({
        collection: 'municipalities',
        data: { name: `Upcoming ${STAMP} ${name}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 } as never,
        overrideAccess: true,
      })
    muni = await makeMuni('A')
    otherMuni = await makeMuni('B')
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Upcoming ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `upcoming-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    for (const m of [muni, otherMuni]) {
      await payload.create({
        collection: 'user-roles',
        data: { user: organizer.id, municipality: m.id, role: 'organizer' },
        overrideAccess: true,
      })
    }

    await makeEvent('published', {})
    await makeEvent('draft', { isDraft: true })
    await makeEvent('cancelled', { status: 'cancelled' })
    await makeEvent('other-obec', { municipality: otherMuni.id })
  })

  afterAll(async () => {
    await payload
      .delete({ collection: 'events', where: { municipality: { in: [muni.id, otherMuni.id] } }, overrideAccess: true })
      .catch(() => {})
    await payload
      .delete({ collection: 'user-roles', where: { user: { equals: organizer.id } }, overrideAccess: true })
      .catch(() => {})
    await payload.delete({ collection: 'users', id: organizer.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload
      .delete({ collection: 'municipalities', where: { id: { in: [muni.id, otherMuni.id] } }, overrideAccess: true })
      .catch(() => {})
  })

  it('lists the published events of the asked municipalities, no drafts or cancelled ones', async () => {
    const { ids: listed } = await list(`?municipality=${muni.id}`)
    expect(listed).toContain(ids.published)
    expect(listed).not.toContain(ids.draft)
    expect(listed).not.toContain(ids.cancelled)
    expect(listed).not.toContain(ids['other-obec'])

    const both = await list(`?municipality=${otherMuni.id}&municipality=${muni.id}`)
    expect(both.ids).toEqual(expect.arrayContaining([ids.published, ids['other-obec']]))
  })

  it('lists every municipality without a filter', async () => {
    const { ids: listed } = await list()
    expect(listed).toEqual(expect.arrayContaining([ids.published, ids['other-obec']]))
    expect(listed).not.toContain(ids.draft)
  })

  it('answers an invalid filter with nothing rather than every municipality', async () => {
    const { ids: listed } = await list('?municipality=abc')
    expect(listed).toEqual([])
  })

  it('is cacheable on the CDN', async () => {
    const { res } = await list(`?municipality=${muni.id}`)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=')
  })
})
