import { APP_TIME_ZONE, pragueDateKey } from '@/lib/date'

import type { WallTime } from './contracts'

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})

const pad = (n: number) => String(n).padStart(2, '0')

/** What a Prague clock shows at `instant`. */
export function instantToPragueWallTime(instant: Date): WallTime {
  const p = Object.fromEntries(
    PARTS.formatToParts(instant).map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})$/

export const isValidWallDate = (date: string): boolean => {
  const m = date.match(DATE_RE)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  )
}

export const isValidWallTime = (time: string): boolean => {
  const m = time.match(TIME_RE)
  return Boolean(m && Number(m[1]) < 24 && Number(m[2]) < 60)
}

/**
 * The instant a Prague clock shows `date` `time` (midnight without a time) — summer time included.
 * Guesses the instant as if Prague were UTC, then corrects by the offset the guess lands on; a second
 * pass settles the hour around the switch.
 */
export function pragueWallTimeToIso(date: string, time: string | null): string {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = (time ?? '00:00').split(':').map(Number)
  const target = Date.UTC(y, mo - 1, d, h, mi)
  let guess = target
  for (let pass = 0; pass < 2; pass++) {
    const shown = instantToPragueWallTime(new Date(guess))
    const [sy, smo, sd] = shown.date.split('-').map(Number)
    const [sh, smi] = shown.time!.split(':').map(Number)
    guess += target - Date.UTC(sy, smo - 1, sd, sh, smi)
  }
  return new Date(guess).toISOString()
}

/** Today in Prague, "YYYY-MM-DD". */
export const pragueToday = (now: Date = new Date()): string => pragueDateKey(now.toISOString())

/** "YYYY-MM-DD" `days` later. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}
