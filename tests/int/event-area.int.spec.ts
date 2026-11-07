import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from 'vitest'

import { eventAreaMapOf, eventAreaMapOfRegion } from '@/lib/events/area'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

// The obec at Žďár nad Sázavou; ~9 km north is inside its 15 km radius, Blansko and Praha are not.
const CENTRE = { lat: 49.5661, lng: 15.9403 }
const INSIDE = { lat: 49.6461, lng: 15.9403 }
const BLANSKO = { lat: 49.3631, lng: 16.6445 }
const PRAHA = { lat: 50.0755, lng: 14.4378 }

describe("An obec's contractual radius — watched by the platform, not enforced", () => {
  let municipality: { id: number }
  let partner: { id: number }
  let partnerOrganizationId: number
  let microregionId: number
  let category: { id: number }
  let organizer: { id: number; email: string }
  let obecAdmin: { id: number; email: string }
  const eventIds: number[] = []

  const createEvent = async (by: { id: number }, place: { lat: number; lng: number }, extra: Record<string, unknown> = {}) => {
    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Area event ${STAMP}-${eventIds.length}`,
        dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
        locationText: 'Někde',
        ...place,
        capacity: 10,
        organizer: by.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        ...extra,
      } as never,
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventIds.push(event.id)
    return event
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Area Obec ${STAMP}`, rulesForCreation: 'approved_organizers', ...CENTRE, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    partner = await payload.create({
      collection: 'municipalities',
      data: { name: `Area Partner ${STAMP}`, rulesForCreation: 'approved_organizers', ...BLANSKO, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    const partnerOrganization = await payload.find({
      collection: 'organizations',
      where: { and: [{ municipality: { equals: partner.id } }, { type: { equals: 'municipality' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    partnerOrganizationId = partnerOrganization.docs[0].id
    // Co-organizing across obce needs a shared mikroregion.
    const region = await payload.create({
      collection: 'microregions',
      data: { name: `Area Region ${STAMP}`, municipalities: [municipality.id, partner.id], mainMunicipality: municipality.id },
      overrideAccess: true,
    })
    microregionId = region.id
    category = await payload.create({ collection: 'event-categories', data: { name: `Area Category ${STAMP}` }, overrideAccess: true })
    const createUser = async (name: string) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `area-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `Area ${name}`, municipality: municipality.id, onboardingCompleted: true },
        overrideAccess: true,
      })
      return user
    }
    organizer = await createUser('organizer')
    obecAdmin = await createUser('admin')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: obecAdmin.id, municipality: municipality.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'microregions', id: microregionId, overrideAccess: true }).catch(() => {})
    for (const id of eventIds) await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("maps the obec's published, coming events — the obec's and its pořadatelé's — and flags those outside", async () => {
    const inside = await createEvent(organizer, INSIDE)
    const outside = await createEvent(organizer, BLANSKO)
    const obecs = await createEvent(obecAdmin, BLANSKO)
    const draft = await createEvent(organizer, BLANSKO, { isDraft: true })
    const cancelled = await createEvent(organizer, BLANSKO)
    await payload.update({
      collection: 'events',
      id: cancelled.id,
      data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
    // Over — the app never creates a past event, so straight through the adapter.
    const past = await payload.db.create({
      collection: 'events',
      data: {
        title: `Area past ${STAMP}`,
        dateTime: new Date(Date.now() - 2 * DAY).toISOString(),
        locationText: 'Někde',
        ...BLANSKO,
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        status: 'finished',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
    })
    eventIds.push(past.id as number)

    const map = await eventAreaMapOf(payload, municipality.id)
    expect(map.areas).toMatchObject([{ id: municipality.id, radiusKm: 15, inScope: true }])
    const byId = new Map(map.events.map((e) => [e.id, e]))

    expect(byId.get(inside.id)).toMatchObject({ outside: false, runBy: 'organizer', kind: 'standalone' })
    expect(byId.get(inside.id)!.distanceKm).toBeCloseTo(8.9, 0)
    expect(byId.get(outside.id)).toMatchObject({ outside: true, runBy: 'organizer' })
    expect(byId.get(outside.id)!.distanceKm).toBeGreaterThan(50)
    expect(byId.get(obecs.id)).toMatchObject({ outside: true, runBy: 'obec' })
    // Not on the map: a draft, a cancelled event, one that's over.
    for (const hidden of [draft.id, cancelled.id, past.id as number]) expect(byId.has(hidden)).toBe(false)
  })

  it('alerts the platform once when a published event lands outside — never for one inside, or a draft until it is published', async () => {
    vi.stubEnv('OPS_DISCORD_WEBHOOK_URL', 'https://discord.test/webhook')
    vi.stubEnv('OPS_ALERT_EMAILS', '')
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const alerts = () =>
      (fetchMock.mock.calls as unknown as [string, RequestInit][])
        .filter(([url]) => url === 'https://discord.test/webhook')
        .map(([, init]) => JSON.parse(String(init.body)) as { embeds: { title: string; fields: { name: string; value: string }[] }[] })

    await createEvent(organizer, INSIDE)
    expect(alerts()).toHaveLength(0)

    const draft = await createEvent(organizer, BLANSKO, { isDraft: true })
    expect(alerts()).toHaveLength(0)

    // Published — now it's reported, with where and how far.
    await payload.update({ collection: 'events', id: draft.id, data: { isDraft: false }, overrideAccess: true, context: { skipNotifications: true } })
    const sent = alerts()
    expect(sent).toHaveLength(1)
    expect(sent[0].embeds[0].title).toBe(`Akce mimo smluvní okruh obce Area Obec ${STAMP}`)
    const fields = Object.fromEntries(sent[0].embeds[0].fields.map((f) => [f.name, f.value]))
    expect(fields.vzdálenost).toMatch(/km od obce Area Obec \d+ \(okruh 15 km\)$/)
    expect(fields.druh).toBe('samostatná')
    expect(fields.obec).toContain(String(municipality.id))

    // Only renamed — not reported again.
    await payload.update({ collection: 'events', id: draft.id, data: { title: 'Přejmenováno' }, overrideAccess: true, context: { skipNotifications: true } })
    expect(alerts()).toHaveLength(1)
  })
  it('lets a mikroregionální event stand in the radius of any obec taking part — and judges a standalone one by its own obec alone', async () => {
    const regionalIn = await createEvent(organizer, BLANSKO, { coOrganizations: [partnerOrganizationId] })
    const regionalOut = await createEvent(organizer, PRAHA, { coOrganizations: [partnerOrganizationId] })
    const standalone = await createEvent(organizer, BLANSKO)

    const map = await eventAreaMapOf(payload, municipality.id)
    // The partner's circle is drawn too, apart from the obec's own.
    expect(map.areas.map((a) => [a.id, a.inScope])).toEqual(expect.arrayContaining([[municipality.id, true], [partner.id, false]]))
    const byId = new Map(map.events.map((e) => [e.id, e]))
    expect(byId.get(regionalIn.id)).toMatchObject({ kind: 'regional', outside: false, nearestObec: `Area Partner ${STAMP}`, partners: [`Area Partner ${STAMP}`] })
    expect(byId.get(regionalOut.id)).toMatchObject({ kind: 'regional', outside: true })
    expect(byId.get(standalone.id)).toMatchObject({ kind: 'standalone', outside: true, nearestObec: `Area Obec ${STAMP}` })
  })

  it("shows the partner obec the events it co-organizes under another obec, and maps a whole mikroregion", async () => {
    const regional = await createEvent(organizer, BLANSKO, { coOrganizations: [partnerOrganizationId] })

    const partnerMap = await eventAreaMapOf(payload, partner.id)
    expect(partnerMap.events.find((e) => e.id === regional.id)).toMatchObject({ kind: 'regional', outside: false, homeObec: `Area Obec ${STAMP}` })

    const regionMap = await eventAreaMapOfRegion(payload, microregionId)
    expect(regionMap.title).toBe(`Area Region ${STAMP}`)
    expect(regionMap.areas.filter((a) => a.inScope).map((a) => a.id).sort()).toEqual([municipality.id, partner.id].sort())
    expect(regionMap.events.filter((e) => e.id === regional.id)).toHaveLength(1)
  })

  it('alerts a mikroregionální event outside every taking obec, naming them — none when it lies in one', async () => {
    vi.stubEnv('OPS_DISCORD_WEBHOOK_URL', 'https://discord.test/webhook')
    vi.stubEnv('OPS_ALERT_EMAILS', '')
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const alerts = () =>
      (fetchMock.mock.calls as unknown as [string, RequestInit][])
        .filter(([url]) => url === 'https://discord.test/webhook')
        .map(([, init]) => JSON.parse(String(init.body)) as { embeds: { title: string; fields: { name: string; value: string }[] }[] })

    await createEvent(organizer, BLANSKO, { coOrganizations: [partnerOrganizationId] })
    expect(alerts()).toHaveLength(0)

    await createEvent(organizer, PRAHA, { coOrganizations: [partnerOrganizationId] })
    const sent = alerts()
    expect(sent).toHaveLength(1)
    expect(sent[0].embeds[0].title).toContain('Mikroregionální akce mimo okruh obcí')
    const fields = Object.fromEntries(sent[0].embeds[0].fields.map((f) => [f.name, f.value]))
    expect(fields.druh).toContain(`Area Partner ${STAMP}`)
  })
})
