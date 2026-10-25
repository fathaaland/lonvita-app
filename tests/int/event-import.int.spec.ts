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
import {
  IMPORT_LIMITS,
  IMPORT_USER_AGENT,
  ROBOTS_ALLOW_LINES,
  type ExtractedEvent,
} from '@/lib/import/contracts'
import {
  ImportFetchError,
  isAllowedByRobots,
  isPublicAddress,
  normalizeSourceUrl,
  parseRobots,
  sniffFileType,
} from '@/lib/import/fetch'
import { computeUsageCost, getUsagePricing } from '@/lib/providers/usage-pricing'
import {
  extractJsonLdEvents,
  findCalendarFeeds,
  googleCalendarIcalUrl,
  htmlToText,
} from '@/lib/import/html'
import { parseIcal } from '@/lib/import/ical'
import { similarTitles, withoutContacts } from '@/lib/import/normalize'
import { aiBudgetOf } from '@/lib/import/usage'
import { sourceActivity, type ImportSourceRow } from '@/integrations/payload/import-queries'
import {
  loadImportContext,
  readUrl,
  storeCandidates,
  waiveRobotsFor,
  type ImportDeps,
} from '@/lib/import/pipeline'
import { addDays, pragueToday, pragueWallTimeToIso } from '@/lib/import/time'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'
import { relationNumber } from '@/lib/relations'
import { applySourceChanges, dismissSyncNotices } from '@/lib/import/sync'
import { enqueueEventUpdated, enqueueImportEvents } from '@/lib/queue/queues'
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

  it('names itself in plain ASCII — a header with anything else is never sent', () => {
    expect(IMPORT_USER_AGENT).toMatch(/^[\x20-\x7e]+$/)
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

  it('a robots.txt group names us by our whole product token, not by a part of it', () => {
    // "bot" is a part of "lonvitabot" — a group for some "bot" isn't ours, and neither is an empty one.
    const notOurs = parseRobots('User-agent: bot\nDisallow: /\n\nUser-agent:\nDisallow: /')
    expect(isAllowedByRobots(notOurs, '/akce')).toBe(true)
    const versioned = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: LonvitaBot/1.0\nDisallow: /akce')
    expect(isAllowedByRobots(versioned, '/akce/koncert')).toBe(false)
  })

  it('tells a PDF or a picture by its bytes, whatever the server calls it', () => {
    expect(sniffFileType(Buffer.from('%PDF-1.7\n…'))).toBe('application/pdf')
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffFileType(Buffer.from('<html><body>Akce</body></html>'))).toBeNull()
  })

  it('the lines a webmaster is asked to add let us into a web that keeps all but search engines out', () => {
    // A web vendor's default (mestopelhrimov.cz): search engines in, everybody else out.
    const vendorDefault =
      'User-agent: googlebot\nUser-agent: seznambot\nDisallow: /aa/\n\nUser-agent: *\nDisallow: /'
    expect(isAllowedByRobots(parseRobots(vendorDefault), '/vismo/kalendar.asp')).toBe(false)
    const withUs = `${vendorDefault}\n\n${ROBOTS_ALLOW_LINES}`
    expect(isAllowedByRobots(parseRobots(withUs), '/vismo/kalendar.asp')).toBe(true)
    expect(isAllowedByRobots(parseRobots(withUs), '/vismo/akce.asp?id=7')).toBe(true)
  })

  it('a robots.txt waiver covers the source’s own site only', async () => {
    const seen: { url: string; ignoreRobots?: boolean }[] = []
    const base = {
      fetchUrl: async (url: string, options?: { ignoreRobots?: boolean }) => {
        seen.push({ url, ignoreRobots: options?.ignoreRobots })
        return { url, contentType: 'text/html', body: Buffer.from('') }
      },
    } as unknown as ImportDeps
    const waived = waiveRobotsFor(base, 'https://www.mestopelhrimov.cz/vismo/kalendar.asp')
    await waived.fetchUrl('https://www.mestopelhrimov.cz/vismo/akce.asp?id=1')
    await waived.fetchUrl('https://mestopelhrimov.cz/kalendar.ics', { validators: null })
    await waived.fetchUrl('https://kulturnidum.cz/program')
    expect(seen.map((s) => s.ignoreRobots)).toEqual([true, true, false])
  })
})

describe('Import — personal data, links and limits', () => {
  it("keeps e-mail addresses and phone numbers out of an event's description", () => {
    expect(
      withoutContacts(
        'Zájezd do Prahy. Přihlášky u paní Novákové, tel. 777 123 456, novakova@seznam.cz.',
      ),
    ).toBe('Zájezd do Prahy. Přihlášky u paní Novákové.')
    expect(withoutContacts('Info a přihlášky: +420 602123456')).toBe('Info a přihlášky')
    // Times, prices and dates aren't phone numbers.
    expect(withoutContacts('Koncert v 19:00, vstupné 150 Kč, 24. 10. 2026')).toBe(
      'Koncert v 19:00, vstupné 150 Kč, 24. 10. 2026',
    )
    expect(withoutContacts('tel. 777 123 456')).toBeNull()
    expect(withoutContacts(null)).toBeNull()
  })

  it("an obec's own AI limit wins over the default", () => {
    expect(aiBudgetOf({})).toBe(IMPORT_LIMITS.aiMonthlyBudgetUsd)
    expect(aiBudgetOf({ importAiBudgetUsd: null })).toBe(IMPORT_LIMITS.aiMonthlyBudgetUsd)
    expect(aiBudgetOf({ importAiBudgetUsd: 12 })).toBe(12)
    expect(aiBudgetOf({ importAiBudgetUsd: 0 })).toBe(0)
  })

  it('bills a long prompt at the long-context rates — the whole call, as Anthropic does', () => {
    const haiku = getUsagePricing('anthropic', 'claude-haiku-5-5')
    const short = computeUsageCost({ kind: 'tokens', inputTokens: 100_000, outputTokens: 1_000 }, haiku)
    expect(short!.costUsd).toBeCloseTo(0.01 + 0.0005, 9)
    const long = computeUsageCost({ kind: 'tokens', inputTokens: 100_001, outputTokens: 1_000 }, haiku)
    expect(long!.costUsd).toBeCloseTo((100_001 / 1e6) * 0.5 + 0.0025, 9)
    // A model without a price is priced as unknown — never as $0.
    expect(computeUsageCost({ kind: 'tokens', inputTokens: 1, outputTokens: 1 }, getUsagePricing('anthropic', 'claude-x'))).toBeNull()
  })

  it('tells a source being read from one waiting for the worker — and a dead worker from either', () => {
    const now = Date.parse('2026-10-24T12:00:00Z')
    const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString()
    const base: ImportSourceRow = {
      id: '1',
      url: 'https://obec.test/',
      label: 'obec.test',
      enabled: true,
      format: null,
      last_run_at: minutesAgo(60),
      last_success_at: null,
      last_error: null,
      last_error_code: null,
      last_found_count: null,
      consecutive_failures: 0,
      ignore_robots: false,
      ignore_robots_at: null,
      queued_at: null,
      running_since: null,
    }
    expect(sourceActivity(base, now)).toBeNull()
    expect(sourceActivity({ ...base, running_since: minutesAgo(2) }, now)).toBe('running')
    expect(sourceActivity({ ...base, queued_at: minutesAgo(1) }, now)).toBe('queued')
    // Asked for before the last read — that read was it.
    expect(sourceActivity({ ...base, queued_at: minutesAgo(90) }, now)).toBeNull()
    expect(
      sourceActivity(
        { ...base, running_since: minutesAgo(IMPORT_LIMITS.runStaleMinutes + 1) },
        now,
      ),
    ).toBeNull()
    expect(
      sourceActivity({ ...base, enabled: false, running_since: minutesAgo(1) }, now),
    ).toBeNull()
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

    // A source's window: nothing starting after its last day.
    const windowed = parseIcal(ics, new Date(), inDays(6))
    expect(windowed.some((e) => e.title === 'Koncert v kostele')).toBe(true)
    expect(windowed.some((e) => e.title === 'Výstava obrazů')).toBe(false)
    expect(windowed.every((e) => e.start.date <= inDays(6))).toBe(true)
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
    // Only with the owner's word that the web is theirs, or that they may take events from it.
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'www.import-obec.cz/kalendar' },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow('Potvrďte')
    const source = await payload.create({
      collection: 'event-sources',
      data: {
        municipality: obec.id,
        url: 'www.import-obec.cz/kalendar',
        ownerConsent: true,
      } as never,
      user: admin,
      overrideAccess: false,
    })
    expect(source.url).toBe('https://www.import-obec.cz/kalendar')
    expect(source.label).toBe('import-obec.cz')
    expect(source.ownerConsentAt).toBeTruthy()
    expect(vi.mocked(enqueueImportEvents)).toHaveBeenCalledWith(
      { kind: 'source', sourceId: source.id, trigger: 'new_source', requestedBy: admin.id },
      expect.anything(),
    )

    await expect(
      payload.create({
        collection: 'event-sources',
        data: {
          municipality: obec.id,
          url: 'https://www.import-obec.cz/kalendar',
          ownerConsent: true,
        } as never,
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow('už máte')
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'http://localhost:3000/', ownerConsent: true } as never,
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'https://cizi.cz/', ownerConsent: true } as never,
        user: otherAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: 'https://x.cz/', ownerConsent: true } as never,
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

  it('two events of one name on one day stay two — the 8:00 and the 10:30 mass', async () => {
    const masses = [
      event({ title: 'Mše u svatého Jakuba', start: { date: inDays(15), time: '08:00' } }),
      event({ title: 'Mše u svatého Jakuba', start: { date: inDays(15), time: '10:30' } }),
    ]
    expect((await storeAsText(masses)).created).toBe(2)
    // Read again, each finds its own — nothing new, nothing moved.
    const again = await storeAsText(masses)
    expect(again).toMatchObject({ created: 0, updated: 0 })
  })

  it('a pending one takes up a place its source names later — looked up again, its warning gone', async () => {
    const title = 'Přednáška o včelaření'
    await storeAsText([event({ title, start: { date: inDays(16), time: '17:00' }, locationName: null })])
    const before = (await candidatesOf(obec.id)).find((c) => c.title === title)!
    expect(before.warnings).toEqual(['location_missing'])
    const second = await storeAsText([event({ title, start: { date: inDays(16), time: '17:00' } })])
    expect(second.updated).toBe(1)
    const after = (await candidatesOf(obec.id)).find((c) => c.title === title)!
    expect(after.warnings).toEqual([])
    expect(after.locationText).toBe('Sokolovna')
    expect(after.lat).toBeCloseTo(area.lat + 0.002)
  })

  it('two decisions at once found the event once — the other finds it decided', async () => {
    const title = 'Souběžně převzatý jarmark'
    await storeAsText([event({ title, start: { date: inDays(17), time: '09:00' } })])
    const candidate = (await candidatesOf(obec.id)).find((c) => c.title === title)!
    const outcomes = await Promise.allSettled([
      approveCandidate(payload, admin, candidate.id),
      approveCandidate(payload, admin, candidate.id),
      rejectCandidate(payload, admin, candidate.id),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    for (const o of outcomes.filter((o) => o.status === 'rejected'))
      expect((o as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
    const founded = await payload.find({
      collection: 'events',
      where: { and: [{ municipality: { equals: obec.id } }, { title: { equals: title } }] },
      depth: 0,
      overrideAccess: true,
    })
    const decided = await payload.findByID({
      collection: 'event-import-candidates',
      id: candidate.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(founded.totalDocs).toBe(decided.status === 'approved' ? 1 : 0)
    if (decided.status === 'approved') expect(decided.event).toBe(founded.docs[0].id)
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

  it("a page that fills its calendar in the browser is said to be one — not read as '0 events' at the AI's price", async () => {
    const context = (await loadImportContext(payload, obec.id))!
    const ai = vi.fn<ImportDeps['extractWithAi']>(async () => [])
    // akce.zdarns.cz: knockout templates, the events posted in by a script.
    const template =
      '<main><h2>Nejbližší</h2><div data-bind="foreach: homepageData().EventsNearest">' +
      '<a data-bind="attr: { href: \'/akce/\' + $data.SeoUrl }"><span data-bind="text: $data.Name">Akce</span>Více</a></div></main>'
    await expect(
      readUrl(
        'https://akce.obec.test/',
        { aiContext: context.aiContext },
        deps({
          fetchUrl: async (url) => ({ url, contentType: 'text/html', body: Buffer.from(template) }),
          extractWithAi: ai,
        }),
      ),
    ).rejects.toThrow(/JavaScriptem/)
    expect(ai).not.toHaveBeenCalled()
  })

  it('asks the server whether a page the AI read changed — and reads nothing when it says no', async () => {
    const context = (await loadImportContext(payload, obec.id))!
    const asked: unknown[] = []
    const ai = vi.fn<ImportDeps['extractWithAi']>(async () => [event({ title: 'Z webu' })])
    const fakeDeps = deps({
      fetchUrl: async (url, options) => {
        asked.push(options?.validators ?? null)
        if (options?.validators?.etag === '"v1"') {
          return {
            url,
            contentType: '',
            body: Buffer.alloc(0),
            notModified: true,
            validators: options.validators,
          }
        }
        return {
          url,
          contentType: 'text/html',
          body: Buffer.from('<main><p>21. 11. Beseda v knihovně</p></main>'),
          validators: { etag: '"v1"', lastModified: null },
        }
      },
      extractWithAi: ai,
    })
    const first = await readUrl(
      'https://obec.test/beseda',
      { aiContext: context.aiContext },
      fakeDeps,
    )
    expect(first.validators).toEqual({ etag: '"v1"', lastModified: null })
    expect(ai).toHaveBeenCalledTimes(1)

    const again = await readUrl(
      'https://obec.test/beseda',
      {
        previousHash: first.contentHash,
        aiContext: context.aiContext,
        previous: { format: first.format, validators: first.validators },
      },
      fakeDeps,
    )
    expect(again).toMatchObject({ unchanged: true, format: 'html', contentHash: first.contentHash })
    expect(asked).toEqual([null, { etag: '"v1"', lastModified: null }])
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

  it("the obec may let the import past its own web's robots.txt — on its word, kept with who and when", async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://www.obec-robots.test/kalendar' },
      overrideAccess: true,
    })
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:posviceni@obec-robots',
      `DTSTART;TZID=Europe/Prague:${inDays(9).replaceAll('-', '')}T140000`,
      'SUMMARY:Posvícení',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    // A web whose robots.txt keeps us out — unless the fetch was told it may go past it.
    const robotsDeps = () =>
      deps({
        fetchUrl: async (url, options) => {
          if (!options?.ignoreRobots)
            throw new ImportFetchError(
              'Web stahování téhle stránky zakazuje (robots.txt).',
              'robots_disallowed',
            )
          return { url, contentType: 'text/calendar', body: Buffer.from(ics) }
        },
      })
    const sourceNow = () =>
      payload.findByID({
        collection: 'event-sources',
        id: source.id,
        depth: 0,
        overrideAccess: true,
      })

    try {
      await processImportEventsJob({ kind: 'source', sourceId: source.id }, {}, robotsDeps())
      expect((await sourceNow()).lastErrorCode).toBe('robots_disallowed')

      // Only the obec's own admins speak for its web.
      for (const user of [otherAdmin, resident]) {
        await expect(
          payload.update({
            collection: 'event-sources',
            id: source.id,
            data: { ignoreRobots: true },
            user,
            overrideAccess: false,
          }),
        ).rejects.toThrow()
      }
      vi.mocked(enqueueImportEvents).mockClear()
      const waived = await payload.update({
        collection: 'event-sources',
        id: source.id,
        data: { ignoreRobots: true, ignoreRobotsBy: resident.id } as never,
        user: admin,
        overrideAccess: false,
      })
      expect(waived.ignoreRobots).toBe(true)
      expect(waived.ignoreRobotsAt).toBeTruthy()
      expect(relationNumber(waived.ignoreRobotsBy)).toBe(admin.id)
      // Read through right away.
      expect(vi.mocked(enqueueImportEvents)).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'source', sourceId: source.id, trigger: 'manual' }),
        expect.anything(),
      )

      const result = await processImportEventsJob(
        { kind: 'source', sourceId: source.id, trigger: 'manual' },
        {},
        robotsDeps(),
      )
      expect(result).toMatchObject({ found: 1, created: 1 })
      const read = await sourceNow()
      expect(read.lastError ?? null).toBeNull()
      expect(read.lastErrorCode ?? null).toBeNull()

      const withdrawn = await payload.update({
        collection: 'event-sources',
        id: source.id,
        data: { ignoreRobots: false },
        user: admin,
        overrideAccess: false,
      })
      expect(withdrawn.ignoreRobotsAt ?? null).toBeNull()
      expect(withdrawn.ignoreRobotsBy ?? null).toBeNull()
    } finally {
      await payload
        .delete({
          collection: 'event-import-candidates',
          where: { source: { equals: source.id } },
          overrideAccess: true,
        })
        .catch(() => {})
    }
  })

  it("an AI-read page links only to its own site — another site's page is neither fetched nor shown", async () => {
    const context = (await loadImportContext(payload, obec.id))!
    const fetched: string[] = []
    const read = await readUrl(
      'https://www.obec-odkazy.test/akce',
      { aiContext: context.aiContext },
      deps({
        fetchUrl: async (url) => {
          fetched.push(url)
          return {
            url,
            contentType: 'text/html',
            body: Buffer.from('<main><p>15. 11. Koncert</p><p>16. 11. Výstava</p></main>'),
          }
        },
        extractWithAi: async () => [
          event({ title: 'Koncert', detailUrl: 'https://obec-odkazy.test/akce/koncert' }),
          event({ title: 'Kultura', detailUrl: 'https://kultura.obec-odkazy.test/vystava' }),
          event({ title: 'Podvrh', detailUrl: 'https://phishing.example/login' }),
        ],
      }),
    )
    expect(read.events.map((e) => [e.title, e.detailUrl])).toEqual([
      ['Koncert', 'https://obec-odkazy.test/akce/koncert'],
      ['Kultura', 'https://kultura.obec-odkazy.test/vystava'],
      ['Podvrh', null],
    ])
    expect(fetched.some((u) => u.includes('phishing'))).toBe(false)
  })

  it('a source that keeps failing is told to its admins, and switched off at the end', async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec-mrtva.test/akce', label: 'Mrtvý web' },
      overrideAccess: true,
    })
    const failing = deps({
      fetchUrl: async () => {
        throw new ImportFetchError('Stránka vrátila chybu 404.', 'http_error')
      },
    })
    const noticesFor = async (title: string) =>
      (
        await payload.find({
          collection: 'notifications',
          where: {
            and: [
              { user: { equals: admin.id } },
              { title: { equals: title } },
              { message: { contains: 'Mrtvý web' } },
            ],
          },
          overrideAccess: true,
        })
      ).totalDocs
    const failOnce = () =>
      processImportEventsJob({ kind: 'source', sourceId: source.id }, {}, failing)
    const setFailures = (n: number) =>
      payload.update({
        collection: 'event-sources',
        id: source.id,
        data: { consecutiveFailures: n },
        overrideAccess: true,
      })

    await failOnce()
    expect(await noticesFor('Zdroj akcí nejde načíst')).toBe(0)
    await setFailures(IMPORT_LIMITS.failuresBeforeNotice - 1)
    await failOnce()
    expect(await noticesFor('Zdroj akcí nejde načíst')).toBe(1)
    await failOnce()
    expect(await noticesFor('Zdroj akcí nejde načíst')).toBe(1)

    await setFailures(IMPORT_LIMITS.failuresBeforePause - 1)
    await failOnce()
    const paused = await payload.findByID({
      collection: 'event-sources',
      id: source.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(paused.enabled).toBe(false)
    expect(paused.consecutiveFailures).toBe(IMPORT_LIMITS.failuresBeforePause)
    expect(paused.runningSince ?? null).toBeNull()
    expect(paused.lastErrorCode).toBe('http_error')
    expect(await noticesFor('Zdroj akcí je pozastavený')).toBe(1)
  })

  it('a read is shown waiting, then running, then done', async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec-prubeh.test/akce' },
      overrideAccess: true,
    })
    expect(source.queuedAt).toBeTruthy()
    let seenWhileRunning: { runningSince?: string | null; queuedAt?: string | null } | null = null
    await processImportEventsJob(
      { kind: 'source', sourceId: source.id, trigger: 'manual' },
      {},
      deps({
        fetchUrl: async (url) => {
          seenWhileRunning = await payload.findByID({
            collection: 'event-sources',
            id: source.id,
            depth: 0,
            overrideAccess: true,
          })
          return { url, contentType: 'text/html', body: Buffer.from('<p>Nic</p>') }
        },
      }),
    )
    expect(seenWhileRunning!.runningSince).toBeTruthy()
    expect(seenWhileRunning!.queuedAt ?? null).toBeNull()
    const done = await payload.findByID({
      collection: 'event-sources',
      id: source.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(done.runningSince ?? null).toBeNull()
    expect(done.lastRunAt).toBeTruthy()

    // Switched off and back on — read again, waiting first.
    await payload.update({
      collection: 'event-sources',
      id: source.id,
      data: { enabled: false },
      user: admin,
      overrideAccess: false,
    })
    const back = await payload.update({
      collection: 'event-sources',
      id: source.id,
      data: { enabled: true },
      user: admin,
      overrideAccess: false,
    })
    expect(new Date(back.queuedAt!).getTime()).toBeGreaterThan(new Date(done.lastRunAt!).getTime())
  })

  it('with AI switched off for the platform, nothing is sent to it — and the obec hears why', async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec-bez-ai.test/akce' },
      overrideAccess: true,
    })
    const ai = vi.fn<ImportDeps['extractWithAi']>(async () => [event({ title: 'Nemá se stát' })])
    await payload.updateGlobal({
      slug: 'import-settings',
      data: { aiEnabled: false },
      overrideAccess: true,
    })
    try {
      // Only the platform's admins hold the switch.
      await expect(
        payload.updateGlobal({
          slug: 'import-settings',
          data: { aiEnabled: true },
          user: admin,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      const result = await processImportEventsJob(
        { kind: 'source', sourceId: source.id, trigger: 'manual' },
        {},
        deps({
          fetchUrl: async (url) => ({
            url,
            contentType: 'text/html',
            body: Buffer.from('<main><p>20. 11. Koncert</p></main>'),
          }),
          extractWithAi: ai,
        }),
      )
      expect(result.skipped).toBe('ai_held_back')
      expect(ai).not.toHaveBeenCalled()
      const read = await payload.findByID({
        collection: 'event-sources',
        id: source.id,
        depth: 0,
        overrideAccess: true,
      })
      expect(read.lastError).toContain('dočasně vypnuté')
      expect(read.lastErrorCode).toBe('disabled')
      // Not the web's fault: no failure counted, so a week of it doesn't switch the source off.
      expect(read.consecutiveFailures ?? 0).toBe(0)
      expect(read.enabled).toBe(true)
      expect(read.lastContentHash ?? null).toBeNull()
    } finally {
      await payload.updateGlobal({
        slug: 'import-settings',
        data: { aiEnabled: true },
        overrideAccess: true,
      })
    }
  })

  it("a source is read only a few weeks ahead — the AI isn't asked for later events, nor are they kept", async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec.test/kalendar-na-pul-roku' },
      overrideAccess: true,
    })
    try {
      const askedUntil: (string | undefined)[] = []
      const result = await processImportEventsJob(
        { kind: 'source', sourceId: source.id, trigger: 'weekly' },
        {},
        deps({
          fetchUrl: async (url) => ({
            url,
            contentType: 'text/html',
            body: Buffer.from('<html><body><p>Program akcí na celý rok</p></body></html>'),
          }),
          extractWithAi: async (_input, context) => {
            askedUntil.push(context.until)
            // A model that ignored the window — what it wrote beyond it still isn't kept.
            return [
              event({ title: 'Blízký koncert', start: { date: inDays(10), time: '18:00' } }),
              event({ title: 'Podzimní ples', start: { date: inDays(60), time: '20:00' } }),
            ]
          },
        }),
      )
      expect(askedUntil).toEqual([inDays(IMPORT_LIMITS.sourceWindowDays)])
      expect(result).toMatchObject({ created: 1 })
      const kept = await payload.find({
        collection: 'event-import-candidates',
        where: { source: { equals: source.id } },
        depth: 0,
        overrideAccess: true,
      })
      expect(kept.docs.map((c) => c.title)).toEqual(['Blízký koncert'])
    } finally {
      await payload
        .delete({
          collection: 'event-import-candidates',
          where: { source: { equals: source.id } },
          overrideAccess: true,
        })
        .catch(() => {})
    }
  })

  it('every run is on the record, and every AI call on the obec’s usage ledger — up to its monthly cap', async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec.test/program-ucet' },
      overrideAccess: true,
    })
    const page = { contentType: 'text/html', body: '<main><p>20. 11. Koncert v kostele</p></main>' }
    const ai = vi.fn<ImportDeps['extractWithAi']>(async (_input, context) => {
      await context.meter?.({
        purpose: 'events',
        model: 'claude-haiku-5-5',
        requestId: 'req_test',
        status: 'success',
        inputTokens: 20_000,
        outputTokens: 2_000,
        cachedInputTokens: 0,
      })
      return [event({ title: 'Koncert v kostele', start: { date: inDays(26), time: '18:00' } })]
    })
    const fakeDeps = deps({
      fetchUrl: async (url) => ({
        url,
        contentType: page.contentType,
        body: Buffer.from(page.body),
      }),
      extractWithAi: ai,
    })

    const result = await processImportEventsJob(
      { kind: 'source', sourceId: source.id, trigger: 'manual', requestedBy: admin.id },
      { jobId: 'job-ucet' },
      fakeDeps,
    )
    expect(result.created).toBe(1)

    const [run] = (
      await payload.find({
        collection: 'import-runs',
        where: { source: { equals: source.id } },
        overrideAccess: true,
      })
    ).docs
    expect(run).toMatchObject({
      trigger: 'manual',
      status: 'success',
      found: 1,
      created: 1,
      aiCalls: 1,
      jobId: 'job-ucet',
    })
    // 20k in × $0.10 + 2k out × $0.50 per million.
    expect(run.costUsd).toBeCloseTo(0.003, 9)

    const [call] = (
      await payload.find({
        collection: 'usage-events',
        where: { importRun: { equals: run.id } },
        depth: 0,
        overrideAccess: true,
      })
    ).docs
    expect(call).toMatchObject({
      municipality: obec.id,
      user: admin.id,
      eventSource: source.id,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      operationType: 'event_import',
      source: 'worker',
      status: 'success',
      requestId: 'req_test',
      totalTokens: 22_000,
    })
    expect(call.costUsd).toBeCloseTo(0.003, 9)
    // Nobody reads the ledger but a platform admin.
    await expect(
      payload.find({ collection: 'usage-events', user: admin, overrideAccess: false }),
    ).rejects.toThrow()

    // Past the obec's fair-use cap the AI isn't called at all — and the owner is told why.
    await payload.create({
      collection: 'usage-events',
      data: {
        municipality: obec.id,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        operationType: 'event_import',
        source: 'worker',
        usageKind: 'tokens',
        costUsd: 1_000,
        status: 'success',
      },
      overrideAccess: true,
    })
    ai.mockClear()
    const capped = await processImportEventsJob(
      { kind: 'source', sourceId: source.id, trigger: 'manual' },
      {},
      fakeDeps,
    )
    expect(capped.skipped).toBe('ai_held_back')
    expect(ai).not.toHaveBeenCalled()
    const afterCap = await payload.findByID({
      collection: 'event-sources',
      id: source.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(afterCap.lastError).toContain('limit')
    expect(afterCap.consecutiveFailures ?? 0).toBe(0)
    const [cappedRun] = (
      await payload.find({
        collection: 'import-runs',
        where: { source: { equals: source.id } },
        sort: '-startedAt',
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).docs
    expect(cappedRun.status).toBe('skipped')
    expect(cappedRun.errorCode).toBe('over_budget')
  })

  it('keeps a taken-over event in step with its calendar — never over what was changed in Lonvita', async () => {
    const source = await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: 'https://obec.test/kalendar.ics' },
      overrideAccess: true,
    })
    const context = (await loadImportContext(payload, obec.id))!
    const pass = (events: ExtractedEvent[]) =>
      storeCandidates(
        payload,
        {
          municipality: context.municipality,
          events,
          origin: 'source',
          originLabel: source.url,
          sourceId: source.id,
          requestedBy: null,
          format: 'ical',
        },
        deps(),
      )
    const ples = (o: Partial<ExtractedEvent> = {}) =>
      event({
        title: 'Hasičský ples',
        externalId: 'ples@obec',
        start: { date: inDays(30), time: '20:00' },
        ...o,
      })
    const trh = (o: Partial<ExtractedEvent> = {}) =>
      event({
        title: 'Farmářský trh',
        externalId: 'trh@obec',
        start: { date: inDays(31), time: '08:00' },
        ...o,
      })
    const besidka = (o: Partial<ExtractedEvent> = {}) =>
      event({
        title: 'Vánoční besídka',
        externalId: 'besidka@obec',
        start: { date: inDays(32), time: '16:00' },
        ...o,
      })
    const ofSource = async () =>
      new Map(
        (
          await payload.find({
            collection: 'event-import-candidates',
            where: { source: { equals: source.id } },
            depth: 0,
            pagination: false,
            overrideAccess: true,
          })
        ).docs.map((c) => [c.title, c]),
      )
    const eventOf = (id: number) =>
      payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true })

    expect((await pass([ples(), trh(), besidka()])).created).toBe(3)
    let found = await ofSource()
    const plesEvent = (await approveCandidate(payload, admin, found.get('Hasičský ples')!.id))
      .eventId
    const trhEvent = (await approveCandidate(payload, admin, found.get('Farmářský trh')!.id))
      .eventId
    const besidkaEvent = (await approveCandidate(payload, admin, found.get('Vánoční besídka')!.id))
      .eventId
    // The obec moves the market's start in Lonvita by hand.
    await payload.update({
      collection: 'events',
      id: trhEvent,
      data: { dateTime: pragueWallTimeToIso(inDays(31), '09:00') },
      user: admin,
      overrideAccess: false,
    })

    // The calendar moves the ball to another day, changes the market's start, calls off the besídka.
    vi.mocked(enqueueEventUpdated).mockClear()
    const second = await pass([
      ples({ start: { date: inDays(33), time: '19:00' } }),
      trh({ start: { date: inDays(31), time: '07:30' } }),
      besidka({ cancelled: true }),
    ])
    expect(second).toMatchObject({ created: 0, synced: 1, needsReview: 2 })
    // The ball follows its calendar (the same UID on another day) — and its registrants hear about it.
    expect((await eventOf(plesEvent)).dateTime).toBe(pragueWallTimeToIso(inDays(33), '19:00'))
    expect(vi.mocked(enqueueEventUpdated)).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: plesEvent }),
    )
    // The market keeps what the obec set; the besídka isn't cancelled by the import.
    expect((await eventOf(trhEvent)).dateTime).toBe(pragueWallTimeToIso(inDays(31), '09:00'))
    expect((await eventOf(besidkaEvent)).status).toBe('active')
    found = await ofSource()
    expect(found.size).toBe(3)
    expect(found.get('Farmářský trh')!.syncNotices).toEqual([
      { code: 'changed', fields: ['start'] },
    ])
    expect(found.get('Vánoční besídka')!.syncNotices).toEqual([{ code: 'cancelled_at_source' }])
    expect(found.get('Hasičský ples')!.syncNeedsReview).toBe(false)

    // The obec takes the web's version of the market over, and sets the besídka's notice aside.
    await expect(
      applySourceChanges(payload, otherAdmin, found.get('Farmářský trh')!.id),
    ).rejects.toMatchObject({ status: 403 })
    await applySourceChanges(payload, admin, found.get('Farmářský trh')!.id)
    expect((await eventOf(trhEvent)).dateTime).toBe(pragueWallTimeToIso(inDays(31), '07:30'))
    await dismissSyncNotices(payload, admin, found.get('Vánoční besídka')!.id)
    found = await ofSource()
    expect(found.get('Farmářský trh')!.syncNeedsReview).toBe(false)
    expect(found.get('Vánoční besídka')!.syncNotices).toEqual([])

    // The besídka drops out of the calendar, which still lists the days around it — after two passes
    // the obec is told; the event stays.
    const later = [
      ples({ start: { date: inDays(33), time: '19:00' } }),
      trh({ start: { date: inDays(31), time: '07:30' } }),
    ]
    expect((await pass(later)).needsReview).toBe(0)
    expect((await pass(later)).needsReview).toBe(1)
    found = await ofSource()
    expect(found.get('Vánoční besídka')!.syncNotices).toEqual([{ code: 'missing_at_source' }])
    expect((await eventOf(besidkaEvent)).status).toBe('active')
  })

  it("import is the obec's alone — an organizer neither adds sources nor sees or takes over candidates", async () => {
    const organizer = await payload.create({
      collection: 'users',
      data: { email: `import-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'profiles',
      data: { user: organizer.id, fullName: 'Kavárník', municipality: obec.id },
      overrideAccess: true,
    })
    // Created with the organizer role in the obec (Organizations grantOrganizerRole).
    const cafe = await payload.create({
      collection: 'organizations',
      data: {
        name: `Kavárna ${STAMP}`,
        type: 'business',
        owner: organizer.id,
        municipality: obec.id,
      },
      overrideAccess: true,
    })
    try {
      for (const data of [
        { municipality: obec.id, url: 'https://kavarna.test/program', ownerConsent: true },
        { organization: cafe.id, url: 'https://kavarna.test/program', ownerConsent: true },
      ]) {
        await expect(
          payload.create({
            collection: 'event-sources',
            data: data as never,
            user: organizer,
            overrideAccess: false,
          }),
        ).rejects.toThrow()
      }

      const context = (await loadImportContext(payload, obec.id))!
      const stored = await storeCandidates(
        payload,
        {
          municipality: context.municipality,
          events: [event({ title: 'Jazz v kavárně', start: { date: inDays(18), time: '20:00' } })],
          origin: 'text',
          originLabel: null,
          sourceId: null,
          requestedBy: null,
        },
        deps(),
      )
      expect(stored.created).toBe(1)
      const obecs = stored.createdIds[0]
      await expect(
        payload.find({
          collection: 'event-import-candidates',
          where: { id: { equals: obecs } },
          user: organizer,
          overrideAccess: false,
        }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(approveCandidate(payload, organizer, obecs)).rejects.toMatchObject({
        status: 403,
      })

      // An organizer's candidate from before is nobody's but the platform admin's.
      const legacy = await payload.create({
        collection: 'event-import-candidates',
        data: {
          municipality: obec.id,
          organization: cafe.id,
          origin: 'source',
          status: 'pending',
          externalKey: `org${cafe.id}:legacy`,
          title: 'Starý kavárenský návrh',
          startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        },
        overrideAccess: true,
      })
      const seenByObec = await payload.find({
        collection: 'event-import-candidates',
        where: { id: { equals: legacy.id } },
        user: admin,
        overrideAccess: false,
      })
      expect(seenByObec.docs).toHaveLength(0)
      for (const user of [admin, organizer]) {
        await expect(approveCandidate(payload, user, legacy.id)).rejects.toMatchObject({
          status: 403,
        })
      }
    } finally {
      await payload
        .delete({
          collection: 'event-import-candidates',
          where: {
            or: [{ organization: { equals: cafe.id } }, { title: { equals: 'Jazz v kavárně' } }],
          },
          overrideAccess: true,
        })
        .catch(() => {})
    }
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
