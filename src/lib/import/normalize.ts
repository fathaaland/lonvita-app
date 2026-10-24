import { createHash } from 'node:crypto'

import type { ExtractedEvent } from './contracts'

/** Lower case, no diacritics, words only — what two spellings of the same name share. */
export const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const tokens = (value: string): Set<string> =>
  new Set(
    normalizeText(value)
      .split(' ')
      .filter((t) => t.length >= 3),
  )

/**
 * Whether two event names are the same event's — "Pouťová zábava" and "POUŤOVÁ ZÁBAVA s kapelou X"
 * are; "Jóga pro děti" and "Jóga pro seniory" aren't. One containing the other, or most of their
 * words shared.
 */
export function similarTitles(a: string, b: string): boolean {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = shorter === na ? nb : na
  if (shorter.length >= 6 && longer.includes(shorter)) return true
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared) >= 0.6
}

const hash = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 32)

/**
 * What identifies the event across passes over its source: the source's own id (iCal UID and
 * occurrence), else its detail page, else its name — each with its date, so the weekly yoga stays one
 * candidate per week. Matching by a similar name on the same day catches the rest (pipeline).
 */
export function externalKeyOf(
  event: Pick<ExtractedEvent, 'externalId' | 'detailUrl' | 'title' | 'start'>,
): string {
  if (event.externalId) return `id:${hash(`${event.externalId}|${event.start.date}`)}`
  if (event.detailUrl) return `url:${hash(`${pageOf(event.detailUrl)}|${event.start.date}`)}`
  return `title:${hash(`${normalizeText(event.title)}|${event.start.date}`)}`
}

const pageOf = (detailUrl: string): string => {
  const url = new URL(detailUrl)
  url.hash = ''
  return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`
}

/**
 * What the event is known by on its source whatever its date — the source's own id, else its own
 * page — so one moved to another day is still recognised; null when only its name and date say
 * which one it is. The weekly yoga whose dates share one page shares one ref too: the pipeline
 * follows a ref only when one event of the pass and one known candidate have it.
 */
export function sourceRefOf(
  event: Pick<ExtractedEvent, 'externalId' | 'detailUrl'>,
): string | null {
  if (event.externalId) return `id:${hash(event.externalId)}`
  if (event.detailUrl) return `url:${hash(pageOf(event.detailUrl))}`
  return null
}

const MONTHS =
  /\b(ledna|unora|brezna|dubna|kvetna|cervna|cervence|srpna|zari|rijna|listopadu|prosince|leden|unor|brezen|duben|kveten|cerven|cervenec|srpen|rijen|listopad|prosinec)\b/
const NUMERIC_DATE = /\b\d{1,2}\.\s?\d{1,2}\.|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/
/** Dated lines that change on their own, without any event changing. */
const NOISE = /aktualiz|posledni (zmena|uprava)|vygenerovan|dnes je|pocasi|navstev|copyright/

/**
 * The part of a page's text that says when events are — every line with a date or a time, with the
 * lines around it (the name above, the place below). Its fingerprint is what decides whether the AI
 * reads the page again: news, a weather box or a visit counter changing elsewhere don't make it.
 * A change it misses (a place on a line of its own, far from the date) the weekly full pass catches.
 */
export function eventLinesOf(text: string): string {
  const lines = text.split('\n').map((l) => l.trim())
  const keep = new Set<number>()
  lines.forEach((line, i) => {
    const plain = normalizeText(line)
    if (NOISE.test(plain)) return
    if (NUMERIC_DATE.test(line) || MONTHS.test(plain)) {
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j)
    }
  })
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => lines[i])
    .filter(Boolean)
    .join('\n')
}

/** The place as one line — "Sokolovna, Nádražní 12" — or null when the source names none. */
export function locationTextOf(
  event: Pick<ExtractedEvent, 'locationName' | 'address'>,
): string | null {
  const name = event.locationName?.trim()
  const address = event.address?.trim()
  if (name && address && !normalizeText(name).includes(normalizeText(address)))
    return `${name}, ${address}`.slice(0, 300)
  return (name || address || null)?.slice(0, 300) ?? null
}

export const contentHash = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Czech numbers as written: +420 / 00420 optional, nine digits in groups (777 123 456, 777123456).
const PHONE = /(?:(?:\+|00)\d{3}[\s.-]?)?\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}\b/g

/** A description without e-mail addresses and phone numbers — they're often a private person's
 * (a newsletter's contact for the trip), and the event page has its own way to reach the organizer. */
export function withoutContacts(text: string | null): string | null {
  if (!text) return text
  const cleaned = text
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    // What introduced the number or address, now introducing nothing ("tel.", "e-mail:").
    .replace(/\b(?:tel|telefon|mob|mobil|e-?mail|kontakt)\b\.?:?(?=[\s,.;:]*(?:[,.;:]|$))/gi, ' ')
    .replace(/\(\s*[,;:]?\s*\)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    // Punctuation left with nothing between it: ", ." → "."
    .replace(/[,;:](?:[\s,;:])*([.!?])/g, '$1')
    .replace(/([,;:])(?:[\s,;:])+/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[\s,;:]+$/, '')
    .trim()
  return cleaned || null
}
