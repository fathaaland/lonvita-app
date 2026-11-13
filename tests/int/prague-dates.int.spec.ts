// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  formatEventDate,
  formatEventTime,
  isToday,
  latestBirthDateInputValue,
  nextDateInputValue,
  pragueStartOfDay,
  pragueWallTimeToDate,
  relativeDay,
  toDateInputValue,
  toTimeInputValue,
} from '@/lib/date'
import { ageOn, byDayOfWeek, periodStart } from '@/lib/analytics'

/**
 * Dates are shown, counted and entered in Prague time whatever clock the code runs on — the server is
 * UTC, a browser may be anywhere. These run at instants where UTC and Prague disagree about the day.
 */
describe('Dates in Prague time (lib/date)', () => {
  afterEach(() => vi.useRealTimers())

  // 23:30 UTC on 7 Nov = 00:30 on 8 Nov in Prague (winter, UTC+1).
  const lateEvening = '2026-11-07T23:30:00.000Z'

  it('formats the event in Prague, not in UTC', () => {
    expect(formatEventDate(lateEvening)).toBe('neděle 8. listopadu')
    expect(formatEventTime(lateEvening)).toBe('0:30')
    expect(toDateInputValue(lateEvening)).toBe('2026-11-08')
    expect(toTimeInputValue(lateEvening)).toBe('00:30')
  })

  it('reads a wall time typed in the form as Prague time — in winter and in summer', () => {
    expect(pragueWallTimeToDate('2026-11-08', '18:00').toISOString()).toBe('2026-11-08T17:00:00.000Z')
    expect(pragueWallTimeToDate('2026-07-08', '18:00').toISOString()).toBe('2026-07-08T16:00:00.000Z')
    // The night the clocks go back (25 Oct 2026, 03:00 CEST → 02:00 CET).
    expect(pragueStartOfDay(new Date('2026-10-25T12:00:00.000Z')).toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(pragueStartOfDay(new Date('2026-10-25T12:00:00.000Z'), 1).toISOString()).toBe('2026-10-25T23:00:00.000Z')
  })

  it('counts today and tomorrow by the Prague calendar', () => {
    vi.useFakeTimers({ now: new Date('2026-11-07T23:10:00.000Z'), toFake: ['Date'] }) // 00:10 on 8 Nov in Prague
    expect(isToday(lateEvening)).toBe(true)
    expect(relativeDay(lateEvening)).toBe('Dnes')
    expect(relativeDay('2026-11-08T23:30:00.000Z')).toBe('Zítra')
    // Past a week: the date without the weekday — "úterý" has a non-ASCII letter.
    expect(relativeDay('2026-11-17T10:00:00.000Z')).toBe('17. listopadu')
    expect(periodStart('30')!.toISOString()).toBe('2026-10-08T22:00:00.000Z')
  })

  it('next day of a date input is calendar arithmetic', () => {
    expect(nextDateInputValue('2026-12-31')).toBe('2027-01-01')
    expect(nextDateInputValue('2026-03-28')).toBe('2026-03-29')
  })

  it('analytics: weekday and age by the Prague calendar', () => {
    // 23:30 UTC Saturday = Sunday in Prague.
    const days = byDayOfWeek([{ id: '1', date_time: lateEvening, status: 'finished' } as never])
    expect(days.find((d) => d.day === 'Ne')!.events).toBe(1)
    // Birthday on 8 Nov: 50 already at 00:30 on 8 Nov in Prague.
    expect(ageOn('1976-11-08T00:00:00.000Z', new Date(lateEvening))).toBe(50)
  })
})

describe('latestBirthDateInputValue (15+ date-of-birth limit)', () => {
  it('is today in Prague, 15 years back', () => {
    // 23:30 UTC on 13 Nov is already 14 Nov in Prague.
    expect(latestBirthDateInputValue(new Date('2026-11-13T23:30:00.000Z'))).toBe('2011-11-14')
  })

  it('falls back to 28 February from a leap day', () => {
    expect(latestBirthDateInputValue(new Date('2028-02-29T12:00:00.000Z'))).toBe('2013-02-28')
  })
})
