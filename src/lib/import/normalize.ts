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
  if (event.detailUrl) {
    const url = new URL(event.detailUrl)
    url.hash = ''
    return `url:${hash(`${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}|${event.start.date}`)}`
  }
  return `title:${hash(`${normalizeText(event.title)}|${event.start.date}`)}`
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
