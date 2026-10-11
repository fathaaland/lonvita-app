import { describe, it, expect } from 'vitest'

import {
  byCategory,
  computeDatavitaWindow,
  computeKpis,
  fillBuckets,
  topOrganizers,
  type EventRow,
  type ProfileRow,
  type RegistrationRow,
} from '@/lib/analytics'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'
import { computeOrganizationStats } from '@/lib/organization-stats'
import { computeReportMetrics } from '@/lib/report'

// The obec dashboard's numbers: naplněnost leaves out events without a limit, volunteers don't
// fill places, and a full event is still an upcoming one.

const DAY = 24 * 60 * 60 * 1000

const event = (id: string, capacity: number, startsIn: number, extra: Partial<EventRow> = {}): EventRow => ({
  id,
  title: id,
  date_time: new Date(Date.now() + startsIn).toISOString(),
  capacity,
  status: 'active',
  category_ids: ['cat'],
  organizer_id: 'org',
  created_at: new Date().toISOString(),
  ...extra,
})

let regId = 0
const reg = (eventId: string, userId: string, extra: Partial<RegistrationRow> = {}): RegistrationRow => ({
  id: String(++regId),
  event_id: eventId,
  user_id: userId,
  status: 'approved',
  created_at: new Date().toISOString(),
  ...extra,
})

describe('Obec statistics', () => {
  const limited = event('limited', 2, DAY)
  const unlimited = event('unlimited', UNLIMITED_CAPACITY, DAY)
  const regs = [
    reg('limited', 'a'),
    reg('limited', 'b'),
    reg('unlimited', 'c'),
    // Helps run the limited event — none of its places.
    reg('limited', 'helper', { role: 'volunteer' }),
  ]

  it('averages naplněnost over the events that have a limit', () => {
    expect(computeKpis([limited, unlimited], regs, []).avgFillRate).toBe(1)
    expect(fillBuckets([limited, unlimited], regs)).toEqual({ full: 1, ok: 0, low: 0 })
    expect(byCategory([limited, unlimited], regs, [{ id: 'cat', name: 'Cat', icon: '', color: '' }])[0]).toMatchObject({
      events: 2,
      approved: 3,
      capacity: 2,
      fillRate: 1,
    })
  })

  it("doesn't count volunteers as participants", () => {
    const kpis = computeKpis([limited, unlimited], regs, [])
    expect(kpis.approvedRegs).toBe(3)
    expect(kpis.activeUsers30d).toBe(3)
  })

  it('counts a full event among the upcoming ones', () => {
    const full = event('full', 2, DAY, { status: 'full' })
    const cancelled = event('cancelled', 2, DAY, { status: 'cancelled' })
    expect(computeKpis([full, cancelled], [], []).eventsUpcoming).toBe(1)
  })

  it("counts a volunteer who came among the obec's volunteers", () => {
    const past = event('past', 10, -DAY)
    const result = computeDatavitaWindow(
      [past],
      [
        reg('past', 'p', { attendance_status: 'attended' }),
        reg('past', 'v', { attendance_status: 'attended', role: 'volunteer' }),
      ],
      new Set(),
      Date.now() - 2 * DAY,
      Date.now(),
      new Set(),
    )
    expect(result.activeParticipants).toBe(2)
    expect(result.volunteerShare).toBe(0.5)
  })

  it("leaves a cancelled event out — it never took place", () => {
    const held = event('held', 2, -DAY)
    const cancelled = event('dropped', 2, -DAY, { status: 'cancelled' })
    const kpis = computeKpis([held, cancelled], [reg('held', 'a'), reg('held', 'b'), reg('dropped', 'c')], [])
    expect(kpis.eventsTotal).toBe(1)
    expect(kpis.eventsPast).toBe(1)
    expect(kpis.approvedRegs).toBe(2)
    expect(kpis.avgFillRate).toBe(1)
  })

  it('a multi-day event still running is neither past nor counted as over', () => {
    const running = event('running', 2, -DAY, { end_date_time: new Date(Date.now() + DAY).toISOString() })
    expect(computeKpis([running], [], []).eventsPast).toBe(0)
  })
})

// Profiles and accounts have ids of their own — every lookup by person must go through user_id.
describe('Obec statistics look people up by their account', () => {
  const profile = (id: string, userId: string, extra: Partial<ProfileRow> = {}): ProfileRow => ({
    id,
    user_id: userId,
    full_name: `Name of ${userId}`,
    created_at: new Date().toISOString(),
    ...extra,
  })

  it('names the organizer, not whoever has a profile id equal to their user id', () => {
    const organized = event('organized', 10, -DAY, { organizer_id: 'u1' })
    const [top] = topOrganizers([organized], [], [profile('u1', 'someone-else'), profile('p9', 'u1')])
    expect(top.name).toBe('Name of u1')
  })

  it('counts the 50+ residents who took part into the report and Datavita', () => {
    const now = new Date()
    const past = event('past50', 10, -10 * DAY)
    const senior = profile('p1', 'u-senior', { date_of_birth: '1950-01-01' })
    const young = profile('p2', 'u-young', { date_of_birth: '2000-01-01' })
    const regs = [
      reg('past50', 'u-senior', { attendance_status: 'attended' }),
      reg('past50', 'u-young', { attendance_status: 'attended' }),
    ]
    const metrics = computeReportMetrics([past], regs, [senior, young])
    expect(metrics.totalMembers50Plus).toBe(1)
    expect(metrics.current.engagementRate50Plus).toBe(1)

    const window = computeDatavitaWindow([past], regs, new Set(['u-senior']), now.getTime() - 30 * DAY, now.getTime(), new Set())
    // The young participant doesn't count towards the 50+ engagement…
    expect(window.engagementRate).toBe(1)
    // …and with no 50+ resident at all there is no engagement to speak of.
    expect(computeDatavitaWindow([past], regs, new Set(), now.getTime() - 30 * DAY, now.getTime(), new Set()).engagementRate).toBe(0)
  })

  it("the report's naplněnost and approved registrations follow the dashboard's rules", () => {
    const limited = event('rep-limited', 2, -10 * DAY)
    const unlimited = event('rep-unlimited', UNLIMITED_CAPACITY, -10 * DAY)
    const metrics = computeReportMetrics(
      [limited, unlimited],
      [reg('rep-limited', 'a'), reg('rep-limited', 'b'), reg('rep-limited', 'helper', { role: 'volunteer' }), reg('rep-unlimited', 'c')],
      [],
    )
    expect(metrics.current.avgFillRate).toBe(1)
    expect(metrics.current.approvedRegistrations).toBe(3)
  })

  it("an organization's people leave its volunteers out", () => {
    const own = event('org-own', 2, -DAY)
    const stats = computeOrganizationStats(
      [own],
      [reg('org-own', 'a'), reg('org-own', 'helper', { role: 'volunteer' })],
      new Set(),
    )
    expect(stats.people).toBe(1)
    expect(stats.fillRate).toBe(0.5)
  })
})
