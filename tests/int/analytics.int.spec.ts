import { describe, it, expect } from 'vitest'

import {
  byCategory,
  computeDatavitaWindow,
  computeKpis,
  fillBuckets,
  type EventRow,
  type RegistrationRow,
} from '@/lib/analytics'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'

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
})
