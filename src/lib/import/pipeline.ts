import type { Payload, Where } from 'payload'

import { pragueDateKey } from '@/lib/date'
import { logger, serializeError } from '@/lib/logger'
import { relationNumber } from '@/lib/relations'
import type { EventImportCandidate } from '@/payload-types'

import {
  extractEventDetailsWithAi,
  extractEventsWithAi,
  ImportAiError,
  isAiConfigured,
  type AiContext,
  type AiInput,
} from './ai'
import {
  IMPORT_LIMITS,
  type ExtractedEvent,
  type ImportOrigin,
  type ImportWarning,
} from './contracts'
import {
  assertRobotsAllow,
  decodeBody,
  fetchPublic,
  sniffFileType,
  type FetchedResource,
  type HttpValidators,
  type RobotsCache,
} from './fetch'
import {
  geocodeWithNominatim,
  locateEvent,
  type GeocodeFn,
  type MunicipalityArea,
  type Point,
} from './geocode'
import {
  extractJsonLdEvents,
  feedToText,
  findCalendarFeeds,
  htmlToText,
  looksLikeFeed,
} from './html'
import { looksLikeIcal, parseIcal } from './ical'
import {
  contentHash,
  eventLinesOf,
  externalKeyOf,
  locationTextOf,
  normalizeText,
  similarTitles,
  sourceRefOf,
  withoutContacts,
} from './normalize'
import { markMissing, syncTakenOver, type SyncPair } from './sync'
import { addDays, pragueToday, pragueWallTimeToIso } from './time'
import { aiBudgetOf } from './usage'

/**
 * From an input to candidates the obec's admin approves (docs/import-akci-z-webu.md):
 * 1. readUrl — what an address holds: an iCal feed, a page that embeds a Google Calendar or declares
 *    schema.org Events (no AI needed for either), or a page, feed, PDF or image the AI reads — skipped
 *    when the page hasn't changed since the last pass;
 * 2. storeCandidates — upcoming events only, each matched against what's already known about it (the
 *    same key, or a similar name on the same day), completed from its own page where the list left the
 *    place or time out, pinned on the map inside the obec's area, checked against the obec's events
 *    for a duplicate, and saved with whatever still needs the admin's attention.
 * Everything the outside world provides comes in through `deps`, so tests run it without network.
 */

export type ImportDeps = {
  fetchUrl: (
    url: string,
    /** `ignoreRobots`: the site's operator let us in past its robots.txt (waiveRobotsFor). */
    options?: { validators?: HttpValidators | null; ignoreRobots?: boolean },
  ) => Promise<FetchedResource>
  extractWithAi: (input: AiInput, context: AiContext) => Promise<ExtractedEvent[]>
  extractDetailsWithAi: typeof extractEventDetailsWithAi
  aiAvailable: () => boolean
  geocode: GeocodeFn
  now: () => Date
}

/** The real world: the public internet (robots.txt respected), Claude and Nominatim. */
export function defaultImportDeps(): ImportDeps {
  const robots: RobotsCache = new Map()
  return {
    fetchUrl: async (url, options) => {
      if (!options?.ignoreRobots) await assertRobotsAllow(url, robots)
      return fetchPublic(url, {
        ...options,
        // Where a redirect leads keeps its robots.txt too — the waiver covers the source's own site.
        beforeRedirect: async (target) => {
          if (options?.ignoreRobots && siteOf(target) === siteOf(url)) return
          await assertRobotsAllow(target, robots)
        },
      })
    },
    extractWithAi: extractEventsWithAi,
    extractDetailsWithAi: extractEventDetailsWithAi,
    aiAvailable: isAiConfigured,
    geocode: geocodeWithNominatim,
    now: () => new Date(),
  }
}

const siteOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '')

/** Whether `url` is on the same site as `base` — the same host, or one's subdomain of the other
 * (kultura.obec.cz under obec.cz). */
export function isSameSite(url: string, base: string): boolean {
  try {
    const a = siteOf(url)
    const b = siteOf(base)
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
  } catch {
    return false
  }
}

/** An event's own page counts only on the site it was read from — what the AI read off a page, and
 * what a calendar or schema.org says alike. A page can say anything: a link elsewhere would be
 * fetched by us (and read with the AI) and shown as the event's source. */
const keepOwnLinks = (events: ExtractedEvent[], pageUrl: string): ExtractedEvent[] =>
  events.map((e) =>
    e.detailUrl && !isSameSite(e.detailUrl, pageUrl) ? { ...e, detailUrl: null } : e,
  )

/** `deps` reading the site of `sourceUrl` past its robots.txt — the obec runs that web and said so
 * (EventSources.ignoreRobots). Its detail pages and embedded calendars too; any other site keeps
 * its own robots.txt. */
export function waiveRobotsFor(deps: ImportDeps, sourceUrl: string): ImportDeps {
  const site = siteOf(sourceUrl)
  return {
    ...deps,
    fetchUrl: (url, options) =>
      deps.fetchUrl(url, { ...options, ignoreRobots: siteOf(url) === site }),
  }
}

export type SourceFormat = 'ical' | 'jsonld' | 'html' | 'feed' | 'pdf' | 'image'

export type ReadResult = {
  events: ExtractedEvent[]
  format: SourceFormat
  /** Fingerprint of what was read — the next pass skips the AI when it's the same. */
  contentHash: string
  /** The same as last time: nothing was extracted, nothing needs to be. */
  unchanged: boolean
  /** What the server identifies this version by — asked back next time (fetch HttpValidators). */
  validators: HttpValidators | null
}

/** Formats the AI reads — the ones worth asking the server whether anything changed at all. A
 * calendar or schema.org page costs nothing to read, and its page staying the same says nothing
 * about the Google Calendar it embeds. */
const AI_FORMATS = new Set<SourceFormat>(['html', 'feed', 'pdf', 'image'])

export class ImportReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportReadError'
  }
}

const requireAi = (deps: ImportDeps) => {
  if (!deps.aiAvailable()) {
    throw new ImportAiError(
      'Tenhle zdroj nemá kalendář ve strojově čitelné podobě a AI čtení není zapnuté.',
      'not_configured',
    )
  }
}

/** What the address holds, as events (see the module comment). A page the AI read last time is
 * asked for only if it changed (`previous.validators`) — the server answering it didn't, nothing is
 * downloaded at all. */
export async function readUrl(
  url: string,
  {
    previousHash,
    aiContext,
    previous,
  }: {
    previousHash?: string | null
    aiContext: AiContext
    previous?: { format?: SourceFormat | null; validators?: HttpValidators | null }
  },
  deps: ImportDeps,
): Promise<ReadResult> {
  const lastFormat = previous?.format ?? null
  const ask =
    previousHash && lastFormat && AI_FORMATS.has(lastFormat) && previous?.validators
      ? previous.validators
      : null
  const resource = await deps.fetchUrl(url, ask ? { validators: ask } : undefined)
  if (resource.notModified && ask && lastFormat && previousHash) {
    return {
      events: [],
      format: lastFormat,
      contentHash: previousHash,
      unchanged: true,
      validators: resource.validators ?? ask,
    }
  }
  const read = await readResource(resource, { previousHash, aiContext }, deps)
  return { ...read, validators: resource.validators ?? null }
}

/** The marks of a page whose content a script fills in once it runs — its list a template here. */
const BROWSER_TEMPLATE =
  /\s(?:data-bind|v-for|v-if|ng-repeat|ng-if|x-for|x-data)=|<div id="(?:root|app|__next)">\s*<\/div>/i

const rendersInBrowser = (html: string): boolean => BROWSER_TEMPLATE.test(html)

/** A calendar that doesn't parse is the source's fault — said to its owner, not retried. */
function readIcal(text: string, now: Date, until?: string): ExtractedEvent[] {
  try {
    return parseIcal(text, now, until)
  } catch {
    throw new ImportReadError('Kalendář iCal na téhle adrese nejde přečíst.')
  }
}

async function readResource(
  resource: FetchedResource,
  { previousHash, aiContext }: { previousHash?: string | null; aiContext: AiContext },
  deps: ImportDeps,
): Promise<Omit<ReadResult, 'validators'>> {
  // By its bytes — a server sending its PDF as application/octet-stream would otherwise have it read
  // as a page, and binary noise sent to the AI.
  const mimeType = sniffFileType(resource.body)

  if (mimeType) {
    const hash = contentHash(resource.body)
    const format = mimeType === 'application/pdf' ? 'pdf' : 'image'
    if (hash === previousHash) return { events: [], format, contentHash: hash, unchanged: true }
    requireAi(deps)
    const fileName = decodeURIComponent(new URL(resource.url).pathname.split('/').pop() || 'soubor')
    const events = await deps.extractWithAi(
      { kind: 'file', data: resource.body, mimeType, fileName },
      aiContext,
    )
    return { events: keepOwnLinks(events, resource.url), format, contentHash: hash, unchanged: false }
  }

  const text = decodeBody(resource)
  if (looksLikeIcal(text)) {
    return {
      events: keepOwnLinks(readIcal(text, deps.now(), aiContext.until), resource.url),
      format: 'ical',
      contentHash: contentHash(text),
      unchanged: false,
    }
  }

  if (looksLikeFeed(text) && !/<html[\s>]/i.test(text.slice(0, 1000))) {
    const feedText = feedToText(text, resource.url)
    const hash = contentHash(eventLinesOf(feedText) || feedText)
    if (hash === previousHash)
      return { events: [], format: 'feed', contentHash: hash, unchanged: true }
    if (!feedText.trim()) return { events: [], format: 'feed', contentHash: hash, unchanged: false }
    requireAi(deps)
    const events = await deps.extractWithAi(
      { kind: 'text', text: feedText, sourceUrl: resource.url },
      aiContext,
    )
    return {
      events: keepOwnLinks(events, resource.url),
      format: 'feed',
      contentHash: hash,
      unchanged: false,
    }
  }

  // The page's own calendar feed, when it has one — exact, and nothing to pay for.
  const feeds = findCalendarFeeds(text, resource.url).slice(0, 3)
  const fromFeeds: ExtractedEvent[] = []
  let feedRead = false
  for (const feed of feeds) {
    try {
      const calendar = decodeBody(await deps.fetchUrl(feed))
      if (!looksLikeIcal(calendar)) continue
      fromFeeds.push(...parseIcal(calendar, deps.now(), aiContext.until))
      feedRead = true
    } catch (error) {
      logger.info('Embedded calendar not readable', {
        event: 'import.feed_unreadable',
        feed,
        ...serializeError(error),
      })
    }
  }
  if (feedRead)
    return {
      events: keepOwnLinks(fromFeeds, resource.url),
      format: 'ical',
      contentHash: contentHash(text),
      unchanged: false,
    }

  const declared = extractJsonLdEvents(text, resource.url)
  if (declared.length > 0)
    return {
      events: keepOwnLinks(declared, resource.url),
      format: 'jsonld',
      contentHash: contentHash(text),
      unchanged: false,
    }

  const pageText = htmlToText(text, resource.url)
  const datedLines = eventLinesOf(pageText)
  // A page that fills its calendar in the browser (knockout, Vue, Angular…) holds only the empty
  // template — not a date on it. Read as it is, it'd be "0 events" every night, at the AI's price.
  if (!datedLines && rendersInBrowser(text)) {
    throw new ImportReadError(
      'Stránka načítá akce až v prohlížeči (JavaScriptem), takže je import nevidí. Zkuste adresu, kde je program přímo v textu stránky (třeba program kulturního domu), nebo kalendář iCal.',
    )
  }
  // Only what says when events are decides whether the AI reads the page again (eventLinesOf).
  const hash = contentHash(datedLines || pageText)
  if (hash === previousHash)
    return { events: [], format: 'html', contentHash: hash, unchanged: true }
  if (!pageText.trim()) return { events: [], format: 'html', contentHash: hash, unchanged: false }
  requireAi(deps)
  const events = await deps.extractWithAi(
    { kind: 'text', text: pageText, sourceUrl: resource.url },
    aiContext,
  )
  return {
    events: keepOwnLinks(events, resource.url),
    format: 'html',
    contentHash: hash,
    unchanged: false,
  }
}

export type StoreInput = {
  municipality: MunicipalityArea & { id: number }
  events: ExtractedEvent[]
  origin: ImportOrigin
  originLabel: string | null
  sourceId: number | null
  requestedBy: number | null
  /** The last day events are taken up to — a source's window (IMPORT_LIMITS.sourceWindowDays).
   * Unset: IMPORT_LIMITS.horizonDays. */
  until?: string
  /** The weekly or a hand-started pass — taken-over events are checked on their own pages too. */
  fullPass?: boolean
  /** What the source was read as — a calendar's titles are exact enough to sync (lib/import/sync). */
  format?: SourceFormat
}

export type StoreResult = {
  created: number
  updated: number
  createdIds: number[]
  /** Taken-over events changed after their source (lib/import/sync). */
  synced: number
  /** Taken-over events with something new for their owner to look at. */
  needsReview: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const LOCATION_WARNINGS: ImportWarning[] = ['location_missing', 'location_not_found', 'outside_radius']

/** The instants a candidate keeps — or null when it's no longer ahead. */
function timesOf(
  event: ExtractedEvent,
  now: Date,
): { startsAt: string; endsAt: string | null } | null {
  const startsAt = pragueWallTimeToIso(event.start.date, event.start.time)
  if (new Date(startsAt).getTime() <= now.getTime()) return null
  let endsAt: string | null = null
  if (event.end) {
    const multiDay = event.end.date > event.start.date
    if (event.end.time || multiDay) {
      const candidate = pragueWallTimeToIso(event.end.date, event.end.time ?? '23:59')
      if (new Date(candidate).getTime() > new Date(startsAt).getTime()) endsAt = candidate
    }
  }
  return { startsAt, endsAt }
}

/** What the list page left out — the place or the time — from the event's own page: its schema.org
 * Event when it declares one, the AI otherwise. Best effort; the candidate keeps its warning if not. */
async function completeFromDetailPage(
  event: ExtractedEvent,
  municipalityName: string,
  deps: ImportDeps,
): Promise<ExtractedEvent> {
  try {
    const resource = await deps.fetchUrl(event.detailUrl!)
    const html = decodeBody(resource)
    const declared = extractJsonLdEvents(html, resource.url).find(
      (d) => d.start.date === event.start.date,
    )
    if (declared) {
      return {
        ...event,
        locationName: event.locationName ?? declared.locationName,
        address: event.address ?? declared.address,
        lat: event.lat ?? declared.lat,
        lng: event.lng ?? declared.lng,
        start: { date: event.start.date, time: event.start.time ?? declared.start.time },
        description: event.description ?? declared.description,
      }
    }
    if (!deps.aiAvailable()) return event
    const details = await deps.extractDetailsWithAi(htmlToText(html, resource.url), event, {
      municipalityName,
    })
    return {
      ...event,
      locationName: event.locationName ?? details.locationName,
      address: event.address ?? details.address,
      start: { date: event.start.date, time: event.start.time ?? details.startTime },
      end:
        event.end ?? (details.endTime ? { date: event.start.date, time: details.endTime } : null),
      description: event.description ?? details.description,
      isPaid: event.isPaid ?? details.isPaid,
      priceCzk: event.priceCzk ?? details.priceCzk,
    }
  } catch (error) {
    logger.info('Event detail page not read', {
      event: 'import.detail_unreadable',
      url: event.detailUrl,
      ...serializeError(error),
    })
    return event
  }
}

type Known = Pick<
  EventImportCandidate,
  | 'id'
  | 'source'
  | 'externalKey'
  | 'sourceRef'
  | 'status'
  | 'title'
  | 'startsAt'
  | 'endsAt'
  | 'timeKnown'
  | 'locationText'
  | 'lat'
  | 'lng'
  | 'warnings'
  | 'event'
  | 'syncNotices'
  | 'missingCount'
>

/** Events placed within the obec's area (a box around its circle — close enough for a warning). */
function withinBox(area: MunicipalityArea): Where {
  const dLat = area.eventRadiusKm / 111
  const dLng = area.eventRadiusKm / (111 * Math.cos((area.lat * Math.PI) / 180))
  return {
    and: [
      { lat: { greater_than_equal: area.lat - dLat } },
      { lat: { less_than_equal: area.lat + dLat } },
      { lng: { greater_than_equal: area.lng - dLng } },
      { lng: { less_than_equal: area.lng + dLng } },
    ],
  }
}

/** Saves `events` as candidates of the obec (see the module comment) and keeps the ones already
 * taken over in step with the source (lib/import/sync). */
export async function storeCandidates(
  payload: Payload,
  input: StoreInput,
  deps: ImportDeps,
): Promise<StoreResult> {
  const now = deps.now()
  const nowIso = now.toISOString()
  const horizon = input.until ?? addDays(pragueToday(now), IMPORT_LIMITS.horizonDays)
  const { municipality } = input
  const result: StoreResult = { created: 0, updated: 0, createdIds: [], synced: 0, needsReview: 0 }

  const upcoming: {
    event: ExtractedEvent
    key: string
    ref: string | null
    startsAt: string
    endsAt: string | null
  }[] = []
  const seenKeys = new Set<string>()
  for (const event of [...input.events].sort((a, b) => a.start.date.localeCompare(b.start.date))) {
    if (event.start.date > horizon) continue
    const times = timesOf(event, now)
    if (!times) continue
    const key = externalKeyOf(event)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    upcoming.push({ event, key, ref: sourceRefOf(event), ...times })
  }
  if (upcoming.length === 0) return result

  // A ref the pass gives more than one event (the weekly yoga on one page) says nothing about which.
  const refCount = new Map<string, number>()
  for (const u of upcoming) if (u.ref) refCount.set(u.ref, (refCount.get(u.ref) ?? 0) + 1)

  const earliest = new Date(new Date(upcoming[0].startsAt).getTime() - DAY_MS).toISOString()
  const latest = new Date(
    new Date(upcoming[upcoming.length - 1].startsAt).getTime() + 2 * DAY_MS,
  ).toISOString()
  const ofObec = { municipality: { equals: municipality.id } }
  // Organizers' candidates from before (access/import) aren't the obec's.
  const ofOwner: Where = { and: [ofObec, { organization: { exists: false } }] }
  const select = {
    source: true,
    externalKey: true,
    sourceRef: true,
    status: true,
    title: true,
    startsAt: true,
    endsAt: true,
    timeKnown: true,
    locationText: true,
    lat: true,
    lng: true,
    warnings: true,
    event: true,
    syncNotices: true,
    missingCount: true,
  } as const
  const findCandidates = (where: Where) =>
    payload.find({
      collection: 'event-import-candidates',
      where: { and: [ofOwner, where] },
      select,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })

  const [byKey, byRef, byDay, categories, places, events] = await Promise.all([
    findCandidates({ externalKey: { in: [...seenKeys] } }),
    refCount.size > 0
      ? findCandidates({ sourceRef: { in: [...refCount.keys()] } })
      : Promise.resolve({ docs: [] }),
    findCandidates({
      and: [
        { startsAt: { greater_than_equal: earliest } },
        { startsAt: { less_than_equal: latest } },
      ],
    }),
    payload.find({
      collection: 'event-categories',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'events',
      where: { and: [ofObec, { deletedAt: { exists: false } }] },
      select: { locationText: true, lat: true, lng: true },
      sort: '-createdAt',
      depth: 0,
      limit: 500,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'events',
      where: {
        and: [
          // The obec's own, and the neighbours' within its area — two obce may take over the same
          // regional calendar (a mikroregion's, a MAS's), and the event shouldn't be in twice.
          { or: [ofObec, withinBox(municipality)] },
          { deletedAt: { exists: false } },
          { status: { not_equals: 'cancelled' } },
          { dateTime: { greater_than_equal: earliest } },
          { dateTime: { less_than_equal: latest } },
        ],
      },
      select: { title: true, dateTime: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])

  const known = new Map<number, Known>()
  for (const doc of [...byKey.docs, ...byRef.docs, ...byDay.docs]) known.set(doc.id, doc as Known)
  const matched = new Set<number>()
  /** The candidate an event of the pass is: the same key, else the same ref (followed when it's one
   * event's and one candidate's — the event moved to another day), else a similar name that day —
   * the one closest in time, so the 8:00 and the 10:30 mass stay two. */
  const findKnown = (key: string, ref: string | null, title: string, startsAt: string) => {
    const open = [...known.values()].filter((k) => !matched.has(k.id))
    const byItsKey = open.find((k) => k.externalKey === key)
    if (byItsKey) return byItsKey
    if (ref && refCount.get(ref) === 1) {
      const holders = [...known.values()].filter((k) => k.sourceRef === ref)
      if (holders.length === 1 && !matched.has(holders[0].id)) return holders[0]
    }
    const day = pragueDateKey(startsAt)
    const at = new Date(startsAt).getTime()
    return open
      .filter((k) => pragueDateKey(k.startsAt) === day && similarTitles(k.title, title))
      .sort(
        (a, b) =>
          Math.abs(new Date(a.startsAt).getTime() - at) -
          Math.abs(new Date(b.startsAt).getTime() - at),
      )[0]
  }

  const categoryByName = new Map(categories.docs.map((c) => [normalizeText(c.name), c.id]))
  const knownPlaces = new Map<string, Point>()
  for (const e of places.docs) {
    const name = normalizeText(e.locationText ?? '')
    if (name && !knownPlaces.has(name) && Number.isFinite(e.lat) && Number.isFinite(e.lng)) {
      knownPlaces.set(name, { lat: e.lat, lng: e.lng })
    }
  }
  const geocodeCache = new Map<string, Point | null>()
  const locate = (event: ExtractedEvent) =>
    locateEvent({ ...event, locationText: locationTextOf(event) }, municipality, {
      geocode: deps.geocode,
      knownPlaces,
      cache: geocodeCache,
    })

  const toSync: SyncPair[] = []
  let detailBudget = IMPORT_LIMITS.detailPagesPerRun
  let syncDetailBudget = IMPORT_LIMITS.syncDetailPagesPerRun

  for (const { event: extracted, key, ref, startsAt, endsAt } of upcoming) {
    const existing = findKnown(key, ref, extracted.title, startsAt)
    if (existing) {
      matched.add(existing.id)
      // Another source of the obec lists it too (a regional calendar besides its own web): it's kept in
      // step with the source it came from only — two sources wording it differently would otherwise
      // change it back and forth on every pass, its registrants told each time.
      const existingSource = relationNumber(existing.source)
      if (existingSource && existingSource !== input.sourceId) continue
      if (existing.status === 'approved') {
        // Taken over: kept in step with its source (lib/import/sync) — the obec's calendar, not a
        // pasted program read once.
        if (!input.sourceId || !existing.event) continue
        let event = extracted
        const incomplete = !locationTextOf(event) || !event.start.time
        if (input.fullPass && incomplete && event.detailUrl && syncDetailBudget > 0) {
          syncDetailBudget--
          event = await completeFromDetailPage(event, municipality.name, deps)
        }
        const times = timesOf(event, now) ?? { startsAt, endsAt }
        toSync.push({ candidate: existing, extracted: event, key, ref, ...times })
        continue
      }
      // Rejected: left alone for good. Still undecided: kept in step with the source.
      if (existing.status !== 'pending') continue
      const warnings = new Set((existing.warnings as string[] | null) ?? [])
      const cancelledBefore = warnings.has('cancelled_at_source')
      const wasMissing = warnings.has('missing_at_source') || (existing.missingCount ?? 0) > 0
      if (extracted.cancelled) warnings.add('cancelled_at_source')
      else warnings.delete('cancelled_at_source')
      warnings.delete('missing_at_source')
      const moved = existing.externalKey !== key
      // A place the source now gives (or gives differently) — looked up again, its warning with it.
      const place = locationTextOf(extracted)
      const placeChanged =
        Boolean(place) && normalizeText(place!) !== normalizeText(existing.locationText ?? '')
      const changed =
        existing.startsAt !== startsAt ||
        existing.title !== extracted.title ||
        cancelledBefore !== extracted.cancelled ||
        wasMissing ||
        moved ||
        placeChanged
      if (!changed) continue
      if (extracted.start.time) warnings.delete('time_missing')
      let relocated: { locationText: string; lat: number | null; lng: number | null } | null = null
      if (placeChanged) {
        const located = await locate(extracted)
        for (const w of LOCATION_WARNINGS) warnings.delete(w)
        if ('warning' in located) warnings.add(located.warning)
        relocated = {
          locationText: place!,
          lat: 'point' in located ? located.point.lat : null,
          lng: 'point' in located ? located.point.lng : null,
        }
      }
      try {
        await payload.update({
          collection: 'event-import-candidates',
          id: existing.id,
          data: {
            title: extracted.title,
            startsAt,
            endsAt,
            timeKnown: Boolean(extracted.start.time),
            warnings: [...warnings],
            missingCount: 0,
            lastSeenAt: nowIso,
            ...(moved ? { externalKey: key, sourceRef: ref } : {}),
            ...(relocated ?? {}),
            ...(extracted.description
              ? { description: withoutContacts(extracted.description) }
              : {}),
          },
          overrideAccess: true,
        })
        result.updated++
      } catch (error) {
        logger.info('Import candidate not updated', {
          event: 'import.candidate_update_skipped',
          candidateId: existing.id,
          ...serializeError(error),
        })
      }
      continue
    }

    if (extracted.cancelled) continue
    // Past the run's limit nothing new is added — but the rest are still matched above, or the
    // events after the cut would look missing from their source (markMissing).
    if (result.created >= IMPORT_LIMITS.candidatesPerRun) continue

    let event = extracted
    const incomplete = !locationTextOf(event) || !event.start.time
    if (incomplete && event.detailUrl && detailBudget > 0) {
      detailBudget--
      event = await completeFromDetailPage(event, municipality.name, deps)
    }
    const times = timesOf(event, now)
    if (!times) continue

    const warnings: ImportWarning[] = []
    const locationText = locationTextOf(event)
    const located = await locate(event)
    if ('warning' in located) warnings.push(located.warning)
    if (!event.start.time) warnings.push('time_missing')
    const categoryIds = [
      ...new Set(
        event.categoryNames
          .map((n) => categoryByName.get(normalizeText(n)))
          .filter((id): id is number => id != null),
      ),
    ]
    if (categoryIds.length === 0) warnings.push('no_category')
    const day = pragueDateKey(times.startsAt)
    const duplicate = events.docs.find(
      (e) => pragueDateKey(e.dateTime) === day && similarTitles(e.title, event.title),
    )
    if (duplicate) warnings.push('possible_duplicate')

    try {
      const created = await payload.create({
        collection: 'event-import-candidates',
        data: {
          municipality: municipality.id,
          source: input.sourceId,
          origin: input.origin,
          originLabel: input.originLabel,
          requestedBy: input.requestedBy,
          externalKey: key,
          sourceRef: ref,
          status: 'pending',
          title: event.title,
          description: withoutContacts(event.description),
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          timeKnown: Boolean(event.start.time),
          locationText,
          lat: 'point' in located ? located.point.lat : null,
          lng: 'point' in located ? located.point.lng : null,
          detailUrl: event.detailUrl,
          categories: categoryIds,
          isPaid: event.isPaid ?? false,
          priceCzk: event.isPaid ? event.priceCzk : null,
          warnings,
          duplicateOf: duplicate?.id ?? null,
          lastSeenAt: nowIso,
        },
        overrideAccess: true,
      })
      known.set(created.id, created as Known)
      matched.add(created.id)
      result.created++
      result.createdIds.push(created.id)
    } catch (error) {
      // Another import found the same event a moment earlier (the unique key) — it's there already.
      logger.info('Import candidate not created', {
        event: 'import.candidate_skipped',
        key,
        ...serializeError(error),
      })
    }
  }

  if (toSync.length > 0) {
    const synced = await syncTakenOver(payload, toSync, {
      municipalityId: municipality.id,
      sourceId: input.sourceId,
      deterministic: input.format === 'ical' || input.format === 'jsonld',
      now,
      locate,
    })
    result.synced += synced.synced
    result.needsReview += synced.needsReview
  }
  if (input.sourceId) {
    const missing = await markMissing(payload, {
      sourceId: input.sourceId,
      owner: ofOwner,
      from: upcoming[0].startsAt,
      to: upcoming[upcoming.length - 1].startsAt,
      matched,
      now,
    })
    result.needsReview += missing.newlyNoticed
  }
  return result
}

/** The obec as the pipeline needs it — the categories the AI may pick from, and what its imports may
 * spend on the AI this month (lib/import/usage). */
export async function loadImportContext(
  payload: Payload,
  municipalityId: number | string,
): Promise<{
  municipality: StoreInput['municipality']
  aiContext: AiContext
  aiBudgetUsd: number
} | null> {
  const municipality = await payload
    .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!municipality) return null
  const categories = await payload.find({
    collection: 'event-categories',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return {
    municipality: {
      id: municipality.id,
      name: municipality.name,
      lat: municipality.lat,
      lng: municipality.lng,
      eventRadiusKm: municipality.eventRadiusKm ?? 15,
    },
    aiContext: {
      municipalityName: municipality.name,
      categoryNames: categories.docs.map((c) => c.name).sort(),
    },
    aiBudgetUsd: aiBudgetOf(municipality),
  }
}
