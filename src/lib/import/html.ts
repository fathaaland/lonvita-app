import { parse, type HTMLElement, NodeType, type Node } from 'node-html-parser'

import { IMPORT_LIMITS, type ExtractedEvent, type WallTime } from './contracts'
import { instantToPragueWallTime, isValidWallDate } from './time'

const absolute = (href: string | undefined | null, base: string): string | null => {
  if (!href) return null
  try {
    const url = new URL(href.trim(), base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

const stripTags = (value: string): string =>
  parse(`<div>${value}</div>`).textContent.replace(/\s+/g, ' ').trim()

// --- schema.org Event (JSON-LD) ----------------------------------------------------------

/** An ISO date or date-time as a Prague wall time: with an offset it's an instant, without one it's
 * read as written. */
export function isoToWallTime(value: unknown): WallTime | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnly) return isValidWallDate(dateOnly[1]) ? { date: dateOnly[1], time: null } : null
  const local = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
  if (local)
    return isValidWallDate(local[1]) ? { date: local[1], time: `${local[2]}:${local[3]}` } : null
  const instant = new Date(text)
  return Number.isNaN(instant.getTime()) ? null : instantToPragueWallTime(instant)
}

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const typesOf = (node: JsonObject): string[] => {
  const type = node['@type']
  return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string')
}

const isEventType = (node: JsonObject) =>
  typesOf(node).some((t) => /Event$/.test(t) || t === 'Festival')

const firstOf = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value)

const textOf = (value: unknown): string | null => {
  const v = firstOf(value)
  if (typeof v === 'string') return v.trim() || null
  if (isObject(v) && typeof v['@value'] === 'string') return (v['@value'] as string).trim() || null
  return null
}

function locationOf(
  value: unknown,
): Pick<ExtractedEvent, 'locationName' | 'address' | 'lat' | 'lng'> {
  const location = firstOf(value)
  if (typeof location === 'string')
    return { locationName: location.trim() || null, address: null, lat: null, lng: null }
  if (!isObject(location)) return { locationName: null, address: null, lat: null, lng: null }
  const rawAddress = firstOf(location.address)
  const address =
    typeof rawAddress === 'string'
      ? rawAddress
      : isObject(rawAddress)
        ? [rawAddress.streetAddress, rawAddress.addressLocality]
            .filter((p) => typeof p === 'string' && p.trim())
            .join(', ')
        : null
  const geo = isObject(location.geo) ? location.geo : null
  const lat = geo ? Number(geo.latitude) : NaN
  const lng = geo ? Number(geo.longitude) : NaN
  return {
    locationName: textOf(location.name),
    address: address || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  }
}

function priceOf(event: JsonObject): Pick<ExtractedEvent, 'isPaid' | 'priceCzk'> {
  if (event.isAccessibleForFree === true || event.isAccessibleForFree === 'true')
    return { isPaid: false, priceCzk: null }
  const offer = firstOf(event.offers)
  if (!isObject(offer)) return { isPaid: null, priceCzk: null }
  const price = Number(String(offer.price ?? offer.lowPrice ?? '').replace(',', '.'))
  if (!Number.isFinite(price)) return { isPaid: null, priceCzk: null }
  const currency =
    typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : 'CZK'
  return { isPaid: price > 0, priceCzk: price > 0 && currency === 'CZK' ? price : null }
}

function collectEventNodes(value: unknown, found: JsonObject[], depth = 0): void {
  if (depth > 8) return
  if (Array.isArray(value)) {
    for (const item of value) collectEventNodes(item, found, depth + 1)
    return
  }
  if (!isObject(value)) return
  if (isEventType(value)) {
    found.push(value)
    return
  }
  for (const nested of Object.values(value)) collectEventNodes(nested, found, depth + 1)
}

/** schema.org Events the page declares about itself (ticket portals, some CMS) — no AI needed. */
export function extractJsonLdEvents(html: string, pageUrl: string): ExtractedEvent[] {
  const root = parse(html)
  const nodes: JsonObject[] = []
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collectEventNodes(JSON.parse(script.rawText), nodes)
    } catch {
      // A broken block among the others — the rest still count.
    }
  }

  const events: ExtractedEvent[] = []
  for (const node of nodes) {
    const title = textOf(node.name)
    const start = isoToWallTime(node.startDate)
    if (!title || !start) continue
    const status = String(node.eventStatus ?? '')
    const description = textOf(node.description)
    const url = absolute(textOf(node.url) ?? textOf(node['@id']), pageUrl)
    events.push({
      title: stripTags(title).slice(0, 200),
      description: description ? stripTags(description).slice(0, 1500) : null,
      start,
      end: isoToWallTime(node.endDate),
      ...locationOf(node.location),
      detailUrl: url,
      categoryNames: [],
      ...priceOf(node),
      cancelled: /EventCancelled/i.test(status),
      externalId: url,
    })
  }
  return events
}

// --- Calendar feeds a page points at -----------------------------------------------------

/** Google Calendar's public iCal address for a calendar id. */
export const googleCalendarIcalUrl = (calendarId: string): string =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`

/**
 * iCal feeds a page itself offers as its calendar: an embedded Google Calendar (its calendar ids
 * turned into their public iCal addresses) and an explicit `<link rel="alternate" type="text/calendar">`.
 * Per-event "add to calendar" links don't count — each is one event, not the calendar.
 */
export function findCalendarFeeds(html: string, pageUrl: string): string[] {
  const root = parse(html)
  const feeds = new Set<string>()
  for (const iframe of root.querySelectorAll('iframe')) {
    const src = absolute(iframe.getAttribute('src') ?? iframe.getAttribute('data-src'), pageUrl)
    if (!src) continue
    const url = new URL(src)
    if (url.hostname !== 'calendar.google.com' || !url.pathname.includes('/embed')) continue
    for (const id of url.searchParams.getAll('src')) feeds.add(googleCalendarIcalUrl(id))
  }
  for (const link of root.querySelectorAll('link[type="text/calendar"]')) {
    const href = absolute(link.getAttribute('href'), pageUrl)
    if (href) feeds.add(href)
  }
  return [...feeds]
}

// --- Page text for the AI ----------------------------------------------------------------

const SKIPPED = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'template',
  'iframe',
  'nav',
  'head',
  'form',
  'select',
  'button',
])
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'li',
  'ul',
  'ol',
  'tr',
  'table',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'time',
  'address',
  'blockquote',
  'hr',
])

/**
 * The page as plain text, the way a person reads it: menus, scripts and forms left out, one block per
 * line, and every link written after its text as `[url]` — so the AI can say which event a detail page
 * belongs to. `<time datetime>` keeps its machine-readable value too.
 */
export function htmlToText(html: string, pageUrl: string): string {
  const root = parse(html, { comment: false })
  const out: string[] = []

  const walk = (node: Node) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      out.push(node.textContent.replace(/\s+/g, ' '))
      return
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return
    const element = node as HTMLElement
    const tag = element.rawTagName?.toLowerCase() ?? ''
    if (
      SKIPPED.has(tag) ||
      element.getAttribute('role') === 'navigation' ||
      element.getAttribute('aria-hidden') === 'true'
    )
      return
    const block = BLOCK.has(tag)
    if (block) out.push('\n')
    if (tag === 'img') {
      const alt = element.getAttribute('alt')?.trim()
      if (alt) out.push(` ${alt} `)
      return
    }
    for (const child of element.childNodes) walk(child)
    if (tag === 'a') {
      const href = absolute(element.getAttribute('href'), pageUrl)
      if (href && href !== pageUrl && element.textContent.trim()) out.push(` [${href}]`)
    }
    if (tag === 'time') {
      const datetime = element.getAttribute('datetime')?.trim()
      if (datetime && !element.textContent.includes(datetime)) out.push(` (${datetime})`)
    }
    if (block) out.push('\n')
  }
  walk(root)

  return out
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, IMPORT_LIMITS.aiTextMaxChars)
}

// --- RSS / Atom ----------------------------------------------------------------------------

export const looksLikeFeed = (text: string): boolean =>
  /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000))

const tagContent = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return null
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim()
}

/** A feed's items as text for the AI — a calendar feed's publication date isn't the event's date,
 * so the AI reads the date out of each item's own words. */
export function feedToText(xml: string, feedUrl: string): string {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? []
  return items
    .map((item) => {
      const title = tagContent(item, 'title')
      const linkText = tagContent(item, 'link')
      const linkHref = item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]
      const link = absolute(linkText || linkHref, feedUrl)
      const body =
        tagContent(item, 'description') ??
        tagContent(item, 'summary') ??
        tagContent(item, 'content') ??
        ''
      return [title && stripTags(title), body && stripTags(body), link && `[${link}]`]
        .filter(Boolean)
        .join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, IMPORT_LIMITS.aiTextMaxChars)
}
