import { pragueToday, pragueWallTimeToIso } from '@/lib/import/time'

/**
 * The obec's licence year — what its SMS quota is counted within. The dates the superadmin set
 * (Municipalities.licencePeriodStart/End); without them the calendar year in Prague. An end left
 * empty is a year after the start.
 *
 * The set period repeats: once it's over (or before it began) the one `now` falls in is the same span
 * moved by whole periods — a licence nobody renewed in the panel must not leave the obec's SMS
 * counted against no period at all (they would never use up the quota nor show as overage).
 */
export type LicencePeriod = {
  start: Date
  end: Date
  /** Identifies the period — the usage alerts are sent once per period. */
  key: string
  /** Set by the superadmin rather than the calendar year. */
  custom: boolean
}

/** `date` moved by `months` calendar months, the day of month kept (the 31st becomes the month's
 * last day), the time of day as it was — always counted from the same original date, so it never drifts. */
const addMonths = (date: Date, months: number): Date => {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + months
  const target = new Date(Date.UTC(y, m, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return target
}

/** Whole calendar months from `start` to `end`, or null when the span isn't a whole number of them. */
const wholeMonthsBetween = (start: Date, end: Date): number | null => {
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth()
  return months > 0 && addMonths(start, months).getTime() === end.getTime() ? months : null
}

const periodKey = (start: Date) => start.toISOString().slice(0, 10)

export function licencePeriodOf(
  municipality: { licencePeriodStart?: string | null; licencePeriodEnd?: string | null },
  now: Date,
): LicencePeriod {
  if (municipality.licencePeriodStart) {
    const start = new Date(municipality.licencePeriodStart)
    const setEnd = municipality.licencePeriodEnd ? new Date(municipality.licencePeriodEnd) : null
    // An end on or before the start (set before the field checked it) would be an empty period — no
    // SMS would ever count against the quota. A year from the start instead, as with no end at all.
    const end = setEnd && setEnd.getTime() > start.getTime() ? setEnd : addMonths(start, 12)
    const months = wholeMonthsBetween(start, end)
    const t = now.getTime()
    if (months !== null) {
      // The k-th repetition: estimated from the length, then nudged to the one holding `now`.
      let k = Math.floor((t - start.getTime()) / (end.getTime() - start.getTime()))
      while (addMonths(start, k * months).getTime() > t) k--
      while (addMonths(start, (k + 1) * months).getTime() <= t) k++
      const s = addMonths(start, k * months)
      return { start: s, end: addMonths(start, (k + 1) * months), key: periodKey(s), custom: true }
    }
    // A span of odd length repeats by its exact length.
    const length = end.getTime() - start.getTime()
    const k = Math.floor((t - start.getTime()) / length)
    const s = new Date(start.getTime() + k * length)
    return { start: s, end: new Date(s.getTime() + length), key: periodKey(s), custom: true }
  }
  const year = pragueToday(now).slice(0, 4)
  const start = new Date(pragueWallTimeToIso(`${year}-01-01`, null))
  const end = new Date(pragueWallTimeToIso(`${Number(year) + 1}-01-01`, null))
  return { start, end, key: `${year}-01-01`, custom: false }
}

/** "2026-11" — the month `now` falls in, in Prague. */
export const pragueMonthKey = (now: Date): string => pragueToday(now).slice(0, 7)

/** [start, end) of a "2026-11" month in Prague. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, mo] = month.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  return {
    from: new Date(pragueWallTimeToIso(`${month}-01`, null)),
    to: new Date(pragueWallTimeToIso(`${next}-01`, null)),
  }
}
