// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

// Nothing here reaches the network: the queue is captured, and the pipeline gets fake fetch, AI and
// geocoding through its `deps`.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueImportEvents: vi.fn(async () => undefined),
  enqueueAttendanceReminder: vi.fn(async () => undefined),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueFeedbackRequest: vi.fn(async () => undefined),
  getQueue: vi.fn(() => ({ getJob: async () => undefined })),
}))

import { approveCandidate, rejectCandidate } from '@/lib/import/approve'
import type { ExtractedEvent } from '@/lib/import/contracts'
import {
  ImportFetchError,
  isAllowedByRobots,
  isPublicAddress,
  normalizeSourceUrl,
  parseRobots,
} from '@/lib/import/fetch'
import {
  extractJsonLdEvents,
  findCalendarFeeds,
  googleCalendarIcalUrl,
  htmlToText,
} from '@/lib/import/html'
import { parseIcal } from '@/lib/import/ical'
import { similarTitles } from '@/lib/import/normalize'
import { loadImportContext, readUrl, storeCandidates, type ImportDeps } from '@/lib/import/pipeline'
import { addDays, pragueToday, pragueWallTimeToIso } from '@/lib/import/time'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'
import { enqueueImportEvents } from '@/lib/queue/queues'
import type { User } from '@/payload-types'

import { processImportEventsJob } from '../../worker/src/processors/import-events.processor'

const STAMP = Date.now()
const today = pragueToday()
const inDays = (n: number) => addDays(today, n)

describe('Import — fetching only from the public internet', () => {
  it('tells public addresses from private ones, IPv6-wrapped ones included', () => {
    for (const address of ['8.8.8.8', '185.15.59.224', '2a00:1450:4001:82b::200e'])
      expect(isPublicAddress(address)).toBe(true)
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('takes what people type, refuses what would reach inside', () => {
    expect(normalizeSourceUrl('www.obec.cz/akce').toString()).toBe('https://www.obec.cz/akce')
    expect(normalizeSourceUrl('webcal://calendar.google.com/x.ics').protocol).toBe('https:')
    for (const url of [
      'http://localhost/akce',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'file:///etc/passwd',
      'ftp://obec.cz/',
      'https://user:pass@obec.cz/',
      'https://obec.cz:8080/',
      'http://intranet/',
      'http://db.internal/',
    ]) {
      expect(() => normalizeSourceUrl(url), url).toThrow(ImportFetchError)
    }
  })

  it("respects robots.txt — our group if it names us, else '*', longest rule wins", () => {
    const rules = parseRobots(
      'User-agent: *\nDisallow: /admin\nAllow: /admin/akce\n\nUser-agent: SomeOtherBot\nDisallow: /',
    )
    expect(isAllowedByRobots(rules, '/kalendar-akci')).toBe(true)
    expect(isAllowedByRobots(rules, '/admin/nastaveni')).toBe(false)
    expect(isAllowedByRobots(rules, '/admin/akce?mesic=11')).toBe(true)
    const ours = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: LonvitaBot\nDisallow: /akce')
    expect(isAllowedByRobots(ours, '/akce/koncert')).toBe(false)
    expect(isAllowedByRobots(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/program.pdf')).toBe(
      false,
    )
  })
})

describe('Import — reading events out of a source', () => {
  it('converts Prague wall time to the right instant, summer and winter', () => {
    expect(pragueWallTimeToIso('2026-07-15', '19:00')).toBe('2026-07-15T17:00:00.000Z')
    expect(pragueWallTimeToIso('2026-12-15', '19:00')).toBe('2026-12-15T18:00:00.000Z')
    expect(pragueWallTimeToIso('2026-10-25', '12:00')).toBe('2026-10-25T11:00:00.000Z')
  })

  it('reads an iCal feed — zoned, UTC, all-day and recurring events, past ones left out', () => {
    const d = (n: number) => inDays(n).replace(/-/g, '')
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:koncert@obec',
      `DTSTART;TZID=Europe/Prague:${d(5)}T190000`,
      `DTEND;TZID=Europe/Prague:${d(5)}T210000`,
      'SUMMARY:Koncert v kostele',
      'LOCATION:Kostel sv. Jiří',
      'DESCRIPTION:Varhanní koncert\\npro celou rodinu',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:utc@obec',
      `DTSTART:${d(6)}T170000Z`,
      'SUMMARY:Přednáška',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:vystava@obec',
      `DTSTART;VALUE=DATE:${d(7)}`,
      `DTEND;VALUE=DATE:${d(10)}`,
      'SUMMARY:Výstava obrazů',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:joga@obec',
      `DTSTART;TZID=Europe/Prague:${d(-14)}T170000`,
      'RRULE:FREQ=WEEKLY;COUNT=10',
      'SUMMARY:Jóga',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:stara@obec',
      `DTSTART;TZID=Europe/Prague:${d(-3)}T170000`,
      'SUMMARY:Už proběhla',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:zrusena@obec',
      `DTSTART;TZID=Europe/Prague:${d(8)}T170000`,
      'STATUS:CANCELLED',
      'SUMMARY:Zrušená beseda',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseIcal(ics)
    const koncert = events.find((e) => e.title === 'Koncert v kostele')!
    expect(koncert.start).toEqual({ date: inDays(5), time: '19:00' })
    expect(koncert.end).toEqual({ date: inDays(5), time: '21:00' })
    expect(koncert.locationName).toBe('Kostel sv. Jiří')
    expect(koncert.description).toBe('Varhanní koncert\npro celou rodinu')

    const utc = events.find((e) => e.title === 'Přednáška')!
    expect(pragueWallTimeToIso(utc.start.date, utc.start.time)).toBe(
      new Date(`${inDays(6)}T17:00:00Z`).toISOString(),
    )

    const vystava = events.find((e) => e.title === 'Výstava obrazů')!
    expect(vystava.start).toEqual({ date: inDays(7), time: null })
    expect(vystava.end).toEqual({ date: inDays(9), time: null })

    const joga = events.filter((e) => e.title === 'Jóga')
    expect(joga.length).toBeGreaterThanOrEqual(7)
    expect(joga.every((e) => e.start.date >= today)).toBe(true)
    expect(new Set(joga.map((e) => e.externalId)).size).toBe(joga.length)

    expect(events.some((e) => e.title === 'Už proběhla')).toBe(false)
    expect(events.find((e) => e.title === 'Zrušená beseda')?.cancelled).toBe(true)
  })

  it('reads schema.org Events a page declares, nested in @graph too', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Akce' },
        {
          '@type': 'MusicEvent',
          name: 'Jazz na náměstí',
          startDate: `${inDays(3)}T18:00:00`,
          location: {
            '@type': 'Place',
            name: 'Náměstí',
            address: { streetAddress: 'Náměstí 1', addressLocality: 'Blansko' },
          },
          offers: { price: '0', priceCurrency: 'CZK' },
          url: '/akce/jazz',
        },
      ],
    })}</script></head><body></body></html>`
    const [event] = extractJsonLdEvents(html, 'https://www.blansko.cz/kalendar')
    expect(event.title).toBe('Jazz na náměstí')
    expect(event.start).toEqual({ date: inDays(3), time: '18:00' })
    expect(event.locationName).toBe('Náměstí')
    expect(event.address).toBe('Náměstí 1, Blansko')
    expect(event.isPaid).toBe(false)
    expect(event.detailUrl).toBe('https://www.blansko.cz/akce/jazz')
  })

  it("finds an embedded Google Calendar's feed, and writes a page out as text with its links", () => {
    const html = `<html><body>
      <nav><a href="/">Úvod</a></nav>
      <script>var x = 1</script>
      <iframe src="https://calendar.google.com/calendar/embed?src=obec%40gmail.com&ctz=Europe/Prague"></iframe>
      <article class="event"><h3>20. října</h3><a href="/koncert">Ondřej &amp; spol.</a><time datetime="19:00">19 h</time></article>
    </body></html>`
    expect(findCalendarFeeds(html, 'https://www.obec.cz/akce')).toEqual([
      googleCalendarIcalUrl('obec@gmail.com'),
    ])
    const text = htmlToText(html, 'https://www.obec.cz/akce')
    expect(text).toContain('Ondřej & spol. [https://www.obec.cz/koncert]')
    expect(text).toContain('(19:00)')
    expect(text).not.toContain('var x')
    expect(text).not.toContain('Úvod')
  })

  it('tells the same event apart from a different one by its name', () => {
    expect(similarTitles('Pouťová zábava', 'POUŤOVÁ ZÁBAVA s kapelou Hrom')).toBe(true)
    expect(similarTitles('Jóga pro děti', 'Jóga pro děti')).toBe(true)
    expect(similarTitles('Jóga pro děti', 'Jóga pro seniory')).toBe(false)
  })
})

describe('Import — candidates, approval and access', () => {
  let payload: Payload
  let obec: { id: number; lat: number; lng: number }
  let otherObec: { id: number }
  let admin: User
  let otherAdmin: User
  let resident: User
  let category: { id: number; name: string }
  let existingEvent: { id: number }

  const area = { lat: 49.5661, lng: 15.9403 }

  const event = (overrides: Partial<ExtractedEvent>): ExtractedEvent => ({
    title: 'Akce',
    description: 'Popis akce pro všechny.',
    start: { date: inDays(10), time: '18:00' },
    end: null,
    locationName: 'Sokolovna',
    address: null,
    detailUrl: null,
    categoryNames: [`Import kategorie ${STAMP}`],
    isPaid: null,
    priceCzk: null,
    cancelled: false,
    externalId: null,
    ...overrides,
  })

  const deps = (overrides: Partial<ImportDeps> = {}): ImportDeps => ({
    fetchUrl: async () => {
      throw new ImportFetchError('offline', 'network')
    },
    extractWithAi: async () => [],
    extractDetailsWithAi: async () => ({
      locationName: null,
      address: null,
      startTime: null,
      endTime: null,
      description: null,
      isPaid: null,
      priceCzk: null,
    }),
    aiAvailable: () => true,
    geocode: async (query) =>
      query.includes('Sokolovna')
        ? { lat: area.lat + 0.002, lng: area.lng }
        : query.includes('Daleko')
          ? { lat: area.lat + 3, lng: area.lng }
          : null,
    now: () => new Date(),
    ...overrides,
  })

  const candidatesOf = async (municipalityId: number) =>
    (
      await payload.find({
        collection: 'event-import-candidates',
        where: { municipality: { equals: municipalityId } },
        sort: 'startsAt',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs

  const storeAsText = async (events: ExtractedEvent[], importDeps: ImportDeps = deps()) => {
    const context = (await loadImportContext(payload, obec.id))!
    return storeCandidates(
      payload,
      {
        municipality: context.municipality,
        events,
        origin: 'text',
        originLabel: null,
        sourceId: null,
        requestedBy: admin.id,
      },
      importDeps,
    )
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    obec = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Import obec ${STAMP}`,
        lat: area.lat,
        lng: area.lng,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
      },
      overrideAccess: true,
    })
    otherObec = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Import jiná ${STAMP}`,
        lat: 50.08,
        lng: 14.42,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
      },
      overrideAccess: true,
    })
    const user = (name: string) =>
      payload.create({
        collection: 'users',
        data: { email: `import-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
    admin = await user('admin')
    otherAdmin = await user('other-admin')
    resident = await user('resident')
    for (const [u, m] of [
      [admin, obec],
      [otherAdmin, otherObec],
    ] as const) {
      await payload.create({
        collection: 'profiles',
        data: { user: u.id, fullName: `Admin ${u.id}`, municipality: m.id },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'user-roles',
        data: { user: u.id, municipality: m.id, role: 'municipality_admin' },
        overrideAccess: true,
      })
    }
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Import kategorie ${STAMP}` },
      overrideAccess: true,
    })
    existingEvent = await payload.create({
      collection: 'events',
      data: {
        title: 'Martinská zábava',
        municipality: obec.id,
        dateTime: pragueWallTimeToIso(inDays(12), '19:00'),
        locationText: 'Sokolovna',
        lat: area.lat + 0.002,
        lng: area.lng,
        capacity: 50,
        registrationApprovalMode: 'auto',
        organizer: admin.id,
        categories: [category.id],
        status: 'active',
      },
      overrideAccess: true,
      context: { skipNotifications: true },
    })
  })

  afterAll(async () => {
    for (const m of [obec, otherObec]) {
      await payload
        .delete({
          collection: 'events',
          where: { municipality: { equals: m.id } },
          overrideAccess: true,
          context: { deletingMunicipality: true },
        })
        .catch(() => {})
      await payload
        .delete({ collection: 'municipalities', id: m.id, overrideAccess: true })
        .catch(() => {})
    }
    await payload
      .delete({ collection: 'event-categories', id: category.id, overrideAccess: true })
      .catch(() => {})
    for (const u of [admin, otherAdmin, resident]) {
      await payload.delete({ collection: 'users', id: u.id, overrideAccess: true }).catch(() => {})
    }
  })

  it("an obec's admin adds sources for their own obec only — public web addresses, each once", async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'www.import-obec.cz/kalendar' },
      user: admin,
      overrideAccess: false,
    })
    expect(source.url).toBe('https://www.import-obec.cz/kalendar')
    expect(source.label).toBe('import-obec.cz')
    expect(vi.mocked(enqueueImportEvents)).toHaveBeenCalledWith(
      { kind: 'source', sourceId: source.id },
      expect.anything(),
    )

    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'https://www.import-obec.cz/kalendar' },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow('už obec má')
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'http://localhost:3000/' },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'https://cizi.cz/' },
        user: otherAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'https://x.cz/' },
        user: resident,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    const seenByOther = await payload.find({
      collection: 'event-sources',
      where: { id: { equals: source.id } },
      user: otherAdmin,
      overrideAccess: false,
    })
    expect(seenByOther.docs).toHaveLength(0)
  })

  it('stores what needs the admin with its warnings, matches what it knows, never twice', async () => {
    const events = [
      event({ title: 'Koncert pěveckého sboru', start: { date: inDays(10), time: '18:00' } }),
      event({ title: 'Jarmark', start: { date: inDays(11), time: null } }),
      event({ title: 'Beseda bez místa', locationName: null }),
      event({ title: 'Výlet Daleko', locationName: 'Daleko' }),
      event({ title: 'Bez kategorie', categoryNames: [] }),
      event({ title: 'Martinská zábava s kapelou', start: { date: inDays(12), time: '19:00' } }),
      event({ title: 'Zrušená', cancelled: true }),
      event({ title: 'Včerejší', start: { date: inDays(-1), time: '18:00' } }),
    ]
    const first = await storeAsText(events)
    expect(first.created).toBe(6)

    const byTitle = new Map((await candidatesOf(obec.id)).map((c) => [c.title, c]))
    expect(byTitle.get('Koncert pěveckého sboru')!.warnings).toEqual([])
    expect(byTitle.get('Koncert pěveckého sboru')!.lat).toBeCloseTo(area.lat + 0.002)
    expect(byTitle.get('Jarmark')!.warnings).toEqual(['time_missing'])
    expect(byTitle.get('Beseda bez místa')!.warnings).toEqual(['location_missing'])
    expect(byTitle.get('Výlet Daleko')!.warnings).toEqual(['outside_radius'])
    expect(byTitle.get('Bez kategorie')!.warnings).toEqual(['no_category'])
    expect(byTitle.get('Martinská zábava s kapelou')!.warnings).toEqual(['possible_duplicate'])
    expect(byTitle.get('Martinská zábava s kapelou')!.duplicateOf).toBe(existingEvent.id)
    expect(byTitle.has('Zrušená')).toBe(false)
    expect(byTitle.has('Včerejší')).toBe(false)

    // The next pass: nothing new — and a pending one follows its source when it moves.
    const moved = events.map((e) =>
      e.title === 'Jarmark' ? { ...e, start: { date: inDays(11), time: '09:00' } } : e,
    )
    const second = await storeAsText(moved)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(1)
    const jarmark = (await candidatesOf(obec.id)).find((c) => c.title === 'Jarmark')!
    expect(jarmark.warnings).toEqual([])
    expect(jarmark.startsAt).toBe(pragueWallTimeToIso(inDays(11), '09:00'))
  })

  it("completes a place the list leaves out from the event's own page", async () => {
    const detailUrl = 'https://www.import-obec.cz/akce/divadlo'
    const result = await storeAsText(
      [
        event({
          title: 'Divadlo pro děti',
          locationName: null,
          detailUrl,
          start: { date: inDays(15), time: '10:00' },
        }),
      ],
      deps({
        fetchUrl: async (url) => ({
          url,
          contentType: 'text/html',
          body: Buffer.from('<p>Místo: Sokolovna</p>'),
        }),
        extractDetailsWithAi: async () => ({
          locationName: 'Sokolovna',
          address: null,
          startTime: null,
          endTime: null,
          description: null,
          isPaid: false,
          priceCzk: null,
        }),
      }),
    )
    expect(result.created).toBe(1)
    const divadlo = (await candidatesOf(obec.id)).find((c) => c.title === 'Divadlo pro děti')!
    expect(divadlo.locationText).toBe('Sokolovna')
    expect(divadlo.warnings).toEqual([])
    expect(divadlo.detailUrl).toBe(detailUrl)
  })

  it('reads a page through its embedded calendar or the AI — and skips an unchanged page', async () => {
    const context = (await loadImportContext(payload, obec.id))!
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a@b\r\nDTSTART;TZID=Europe/Prague:${inDays(4).replace(/-/g, '')}T180000\r\nSUMMARY:Z kalendáře\r\nEND:VEVENT\r\nEND:VCALENDAR`
    const pages: Record<string, { contentType: string; body: string }> = {
      'https://obec.test/kalendar': {
        contentType: 'text/html',
        body: '<iframe src="https://calendar.google.com/calendar/embed?src=obec%40gmail.com"></iframe>',
      },
      [googleCalendarIcalUrl('obec@gmail.com')]: { contentType: 'text/calendar', body: ics },
      'https://obec.test/program': {
        contentType: 'text/html; charset=utf-8',
        body: '<main><h2>Program</h2><p>20. 11. Koncert</p></main>',
      },
    }
    const ai = vi.fn<ImportDeps['extractWithAi']>(async () => [event({ title: 'Z AI' })])
    const fakeDeps = deps({
      fetchUrl: async (url) => {
        const page = pages[url]
        if (!page) throw new ImportFetchError('404', 'http_error')
        return { url, contentType: page.contentType, body: Buffer.from(page.body) }
      },
      extractWithAi: ai,
    })

    const fromCalendar = await readUrl(
      'https://obec.test/kalendar',
      { aiContext: context.aiContext },
      fakeDeps,
    )
    expect(fromCalendar.format).toBe('ical')
    expect(fromCalendar.events.map((e) => e.title)).toEqual(['Z kalendáře'])
    expect(ai).not.toHaveBeenCalled()

    const fromAi = await readUrl(
      'https://obec.test/program',
      { aiContext: context.aiContext },
      fakeDeps,
    )
    expect(fromAi.format).toBe('html')
    expect(fromAi.events.map((e) => e.title)).toEqual(['Z AI'])
    expect(ai).toHaveBeenCalledTimes(1)
    expect(ai.mock.calls[0][0]).toMatchObject({
      kind: 'text',
      text: expect.stringContaining('20. 11. Koncert'),
    })

    const again = await readUrl(
      'https://obec.test/program',
      { previousHash: fromAi.contentHash, aiContext: context.aiContext },
      fakeDeps,
    )
    expect(again.unchanged).toBe(true)
    expect(ai).toHaveBeenCalledTimes(1)
  })

  it('only admins of the obec see its candidates, and nobody writes them over the API', async () => {
    const seen = await payload.find({
      collection: 'event-import-candidates',
      where: { municipality: { equals: obec.id } },
      user: otherAdmin,
      overrideAccess: false,
    })
    expect(seen.docs).toHaveLength(0)
    const own = await payload.find({
      collection: 'event-import-candidates',
      where: { municipality: { equals: obec.id } },
      user: admin,
      overrideAccess: false,
    })
    expect(own.docs.length).toBeGreaterThan(0)
    await expect(
      payload.create({
        collection: 'event-import-candidates',
        data: {
          municipality: obec.id,
          origin: 'text',
          status: 'pending',
          externalKey: 'x',
          title: 'Podvrh',
          startsAt: new Date().toISOString(),
        },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'event-import-candidates',
        id: own.docs[0].id,
        data: { status: 'approved' },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('approving founds the event as the obec — unlimited, without approval — and it never comes back', async () => {
    const koncert = (await candidatesOf(obec.id)).find(
      (c) => c.title === 'Koncert pěveckého sboru',
    )!
    await expect(approveCandidate(payload, otherAdmin, koncert.id)).rejects.toMatchObject({
      status: 403,
    })

    const { eventId } = await approveCandidate(payload, admin, koncert.id)
    const created = await payload.findByID({
      collection: 'events',
      id: eventId,
      depth: 1,
      overrideAccess: true,
    })
    expect(created.title).toBe('Koncert pěveckého sboru')
    expect(created.capacity).toBe(UNLIMITED_CAPACITY)
    expect(created.registrationApprovalMode).toBe('auto')
    expect(created.dateTime).toBe(pragueWallTimeToIso(inDays(10), '18:00'))
    expect((created.organization as { type: string }).type).toBe('municipality')

    const decided = await payload.findByID({
      collection: 'event-import-candidates',
      id: koncert.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(decided.status).toBe('approved')
    expect(decided.event).toBe(eventId)
    await expect(approveCandidate(payload, admin, koncert.id)).rejects.toMatchObject({
      status: 409,
    })

    const again = await storeAsText([event({ title: 'Koncert pěveckého sboru' })])
    expect(again.created).toBe(0)
  })

  it('an event found on a source remembers the page it was taken from', async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://zdroj.test/akce' },
      overrideAccess: true,
    })
    const context = (await loadImportContext(payload, obec.id))!
    await storeCandidates(
      payload,
      {
        municipality: context.municipality,
        events: [event({ title: 'Lampionový průvod', start: { date: inDays(16), time: '17:00' } })],
        origin: 'source',
        originLabel: source.url,
        sourceId: source.id,
        requestedBy: null,
      },
      deps(),
    )
    const lampiony = (await candidatesOf(obec.id)).find((c) => c.title === 'Lampionový průvod')!
    const { eventId } = await approveCandidate(payload, admin, lampiony.id)
    const created = await payload.findByID({
      collection: 'events',
      id: eventId,
      depth: 0,
      overrideAccess: true,
    })
    expect(created.importedFrom).toBe('https://zdroj.test/akce')

    // A client can't set it on an event of its own.
    const forged = await payload.create({
      collection: 'events',
      data: {
        title: 'Podvržený zdroj',
        municipality: obec.id,
        dateTime: pragueWallTimeToIso(inDays(17), '17:00'),
        locationText: 'Sokolovna',
        lat: area.lat,
        lng: area.lng,
        capacity: 10,
        registrationApprovalMode: 'auto',
        organizer: admin.id,
        categories: [category.id],
        status: 'active',
        importedFrom: 'https://phishing.test/',
      },
      user: admin,
      overrideAccess: false,
    })
    expect(forged.importedFrom ?? null).toBeNull()
  })

  it("an incomplete one goes in only with the admin's edits — checked by the event's own rules", async () => {
    const beseda = (await candidatesOf(obec.id)).find((c) => c.title === 'Beseda bez místa')!
    await expect(approveCandidate(payload, admin, beseda.id)).rejects.toMatchObject({ status: 400 })

    const edits = {
      title: 'Beseda s kronikářem',
      description: 'Povídání o historii obce.',
      dateTime: pragueWallTimeToIso(inDays(10), '17:00'),
      endDateTime: null,
      locationText: 'Knihovna',
      lat: area.lat,
      lng: area.lng,
      categoryIds: [category.id],
      capacity: 30,
      registrationApprovalMode: 'manual' as const,
      accessibilityTags: [],
      imageId: null,
      imagePositionX: 50,
      imagePositionY: 50,
      isVolunteering: false,
      isPaid: false,
      priceCents: null,
    }
    await expect(
      approveCandidate(payload, admin, beseda.id, { ...edits, lat: 50.08, lng: 14.42 }),
    ).rejects.toThrow('okruh')
    const { eventId } = await approveCandidate(payload, admin, beseda.id, edits)
    const created = await payload.findByID({
      collection: 'events',
      id: eventId,
      depth: 0,
      overrideAccess: true,
    })
    expect(created.title).toBe('Beseda s kronikářem')
    expect(created.capacity).toBe(30)
    expect(created.registrationApprovalMode).toBe('manual')
  })

  it('rejecting sets it aside for good', async () => {
    const vylet = (await candidatesOf(obec.id)).find((c) => c.title === 'Výlet Daleko')!
    await expect(rejectCandidate(payload, otherAdmin, vylet.id)).rejects.toMatchObject({
      status: 403,
    })
    await rejectCandidate(payload, admin, vylet.id)
    const decided = await payload.findByID({
      collection: 'event-import-candidates',
      id: vylet.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(decided.status).toBe('rejected')
    await expect(rejectCandidate(payload, admin, vylet.id)).rejects.toMatchObject({ status: 409 })
  })

  it("the worker writes a source's outcome on it — and a refusal from the site isn't retried", async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec.test/rss' },
      overrideAccess: true,
    })
    const feed = `<?xml version="1.0"?><rss><channel><item><title>Den otevřených dveří</title><description>Sobota v 10:00, hasičská zbrojnice</description><link>https://obec.test/den</link></item></channel></rss>`
    const result = await processImportEventsJob(
      { kind: 'source', sourceId: source.id },
      {},
      deps({
        fetchUrl: async (url) => ({
          url,
          contentType: 'application/rss+xml',
          body: Buffer.from(feed),
        }),
        extractWithAi: async () => [
          event({ title: 'Den otevřených dveří', start: { date: inDays(20), time: '10:00' } }),
        ],
      }),
    )
    expect(result).toMatchObject({ found: 1, created: 1 })
    const read = await payload.findByID({
      collection: 'event-sources',
      id: source.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(read.format).toBe('feed')
    expect(read.lastError ?? null).toBeNull()
    expect(read.lastSuccessAt).toBeTruthy()
    const notified = await payload.find({
      collection: 'notifications',
      where: {
        and: [{ user: { equals: admin.id } }, { title: { equals: 'Nové akce k převzetí' } }],
      },
      overrideAccess: true,
    })
    expect(notified.totalDocs).toBeGreaterThan(0)

    const failed = await processImportEventsJob(
      { kind: 'source', sourceId: source.id },
      {},
      deps({
        fetchUrl: async () => {
          throw new ImportFetchError(
            'Web stahování téhle stránky zakazuje (robots.txt).',
            'robots_disallowed',
          )
        },
      }),
    )
    expect(failed.skipped).toBe('read_failed')
    const afterFailure = await payload.findByID({
      collection: 'event-sources',
      id: source.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(afterFailure.lastError).toContain('robots.txt')
    expect(afterFailure.consecutiveFailures).toBe(1)
  })

  it('deleting the obec takes its sources and candidates along', async () => {
    const temp = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Import dočasná ${STAMP}`,
        lat: 49,
        lng: 16,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
      },
      overrideAccess: true,
    })
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: temp.id, url: 'https://docasna.test/' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'event-import-candidates',
      data: {
        municipality: temp.id,
        source: source.id,
        origin: 'source',
        status: 'pending',
        externalKey: 'k',
        title: 'X',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      overrideAccess: true,
    })
    await payload.delete({ collection: 'municipalities', id: temp.id, overrideAccess: true })
    expect(
      (
        await payload.count({
          collection: 'event-sources',
          where: { municipality: { equals: temp.id } },
          overrideAccess: true,
        })
      ).totalDocs,
    ).toBe(0)
    expect(
      (
        await payload.count({
          collection: 'event-import-candidates',
          where: { municipality: { equals: temp.id } },
          overrideAccess: true,
        })
      ).totalDocs,
    ).toBe(0)
  })
})
