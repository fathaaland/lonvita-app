import ICAL from 'ical.js'

import { IMPORT_LIMITS, type ExtractedEvent, type WallTime } from './contracts'
import { addDays, instantToPragueWallTime, pragueToday } from './time'

type IcalTime = InstanceType<typeof ICAL.Time>

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * An iCal time as a Prague wall time. UTC times are converted; anything else — a TZID (nearly always
 * Europe/Prague on Czech calendars) or a floating time — is read as written, which is what the
 * calendar's own app shows people here. An all-day value (VALUE=DATE) has no time.
 */
function toWallTime(time: IcalTime): WallTime {
  const date = `${time.year}-${pad(time.month)}-${pad(time.day)}`
  if (time.isDate) return { date, time: null }
  if (time.zone?.tzid === 'UTC') return instantToPragueWallTime(time.toJSDate())
  return { date, time: `${pad(time.hour)}:${pad(time.minute)}` }
}

/** An all-day event's DTEND is the day after it ends (exclusive) — the last day it runs is one before. */
function toEndWallTime(start: IcalTime, end: IcalTime | null): WallTime | null {
  if (!end) return null
  if (end.isDate) {
    const last = addDays(`${end.year}-${pad(end.month)}-${pad(end.day)}`, -1)
    const first = `${start.year}-${pad(start.month)}-${pad(start.day)}`
    return last > first ? { date: last, time: null } : null
  }
  return toWallTime(end)
}

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, max) : null
}

const asUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Whether the text is an iCalendar file. */
export const looksLikeIcal = (text: string): boolean => /^\s*BEGIN:VCALENDAR/i.test(text)

/**
 * The upcoming events of an iCalendar feed (Google Calendar's "secret address in iCal format", an
 * Outlook publish link, a WordPress calendar plugin's export). A recurring event is spelled out into
 * its single dates over the next IMPORT_LIMITS.recurrenceDaysAhead days.
 */
export function parseIcal(text: string, now: Date = new Date()): ExtractedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(vtimezone)
    } catch {
      // An odd VTIMEZONE only matters for converting — times are read as written anyway.
    }
  }

  const today = pragueToday(now)
  const horizon = addDays(today, IMPORT_LIMITS.horizonDays)
  const recurrenceHorizon = addDays(today, IMPORT_LIMITS.recurrenceDaysAhead)
  const events: ExtractedEvent[] = []

  const push = (
    vevent: InstanceType<typeof ICAL.Component>,
    start: IcalTime,
    end: IcalTime | null,
    occurrenceKey: string,
  ) => {
    const event = new ICAL.Event(vevent)
    const startWall = toWallTime(start)
    const endWall = toEndWallTime(start, end)
    const lastDay = endWall?.date ?? startWall.date
    if (lastDay < today || startWall.date > horizon) return
    const status = String(vevent.getFirstPropertyValue('status') ?? '').toUpperCase()
    const geo = vevent.getFirstPropertyValue('geo') as [number, number] | null
    const title = clean(event.summary, 200)
    if (!title) return
    events.push({
      title,
      description: clean(event.description, 1500),
      start: startWall,
      end: endWall,
      locationName: clean(event.location, 300),
      address: null,
      lat: Array.isArray(geo) && Number.isFinite(geo[0]) ? Number(geo[0]) : null,
      lng: Array.isArray(geo) && Number.isFinite(geo[1]) ? Number(geo[1]) : null,
      detailUrl: asUrl(vevent.getFirstPropertyValue('url')),
      categoryNames: [],
      isPaid: null,
      priceCzk: null,
      cancelled: status === 'CANCELLED',
      externalId: event.uid ? `${event.uid}#${occurrenceKey}` : null,
    })
  }

  for (const vevent of root.getAllSubcomponents('vevent')) {
    // An overridden occurrence (RECURRENCE-ID) is listed as its own VEVENT — taken as it is.
    const event = new ICAL.Event(vevent)
    if (!event.startDate) continue
    if (!event.isRecurring() || vevent.hasProperty('recurrence-id')) {
      const key = vevent.hasProperty('recurrence-id')
        ? String(vevent.getFirstPropertyValue('recurrence-id'))
        : event.startDate.toString()
      push(vevent, event.startDate, event.endDate ?? null, key)
      continue
    }
    const iterator = event.iterator()
    let occurrence: IcalTime | null
    let count = 0
    while ((occurrence = iterator.next()) && count < 5000) {
      count++
      const wall = toWallTime(occurrence)
      if (wall.date > recurrenceHorizon) break
      if (wall.date < today) continue
      const details = event.getOccurrenceDetails(occurrence)
      push(vevent, details.startDate, details.endDate ?? null, occurrence.toString())
    }
  }
  return events
}
