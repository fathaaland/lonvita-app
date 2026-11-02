import { pragueToday, pragueWallTimeToIso } from '@/lib/import/time'

/**
 * The obec's licence year — what its SMS quota is counted within. The dates the superadmin set
 * (Municipalities.licencePeriodStart/End); without them the calendar year in Prague. An end left
 * empty is a year after the start.
 */
export type LicencePeriod = {
  start: Date
  end: Date
  /** Identifies the period — the usage alerts are sent once per period. */
  key: string
  /** Set by the superadmin rather than the calendar year. */
  custom: boolean
}

const addYear = (date: Date) => {
  const next = new Date(date)
  next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}

export function licencePeriodOf(
  municipality: { licencePeriodStart?: string | null; licencePeriodEnd?: string | null },
  now: Date,
): LicencePeriod {
  if (municipality.licencePeriodStart) {
    const start = new Date(municipality.licencePeriodStart)
    const end = municipality.licencePeriodEnd
      ? new Date(municipality.licencePeriodEnd)
      : addYear(start)
    return { start, end, key: start.toISOString().slice(0, 10), custom: true }
  }
  const year = pragueToday(now).slice(0, 4)
  const start = new Date(pragueWallTimeToIso(`${year}-01-01`, null))
  const end = new Date(pragueWallTimeToIso(`${Number(year) + 1}-01-01`, null))
  return { start, end, key: `${year}-01-01`, custom: false }
}

/** "2026-11" — the month `now` falls in, in Prague. */
export const pragueMonthKey = (now: Date): string => pragueToday(now).slice(0, 7)
