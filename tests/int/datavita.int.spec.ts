import { describe, it, expect } from 'vitest'

import { computeDatavitaWindow, DATAVITA_MIN_PARTICIPANTS, DATAVITA_MIN_EVENTS } from '@/lib/analytics'

import type { EventRow, RegistrationRow } from '@/lib/analytics'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function makeEvents(count: number, opts: { volunteering?: boolean; organizerCount?: number } = {}): EventRow[] {
  const organizerCount = opts.organizerCount ?? 1
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    title: `Event ${i}`,
    date_time: new Date(Date.now() - i * HOUR).toISOString(),
    capacity: 20,
    status: 'active',
    category_ids: [],
    organizer_id: `org${i % organizerCount}`,
    created_at: new Date().toISOString(),
    is_volunteering: opts.volunteering ?? false,
  }))
}

function makeAttendedRegs(count: number, events: EventRow[]): RegistrationRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    event_id: events[i % events.length].id,
    user_id: `u${i}`,
    status: 'approved',
    created_at: new Date().toISOString(),
    attendance_status: 'attended' as const,
  }))
}

const WINDOW_END = Date.now() + DAY
const WINDOW_START = Date.now() - 7 * DAY

describe('computeDatavitaWindow — safety threshold (spec §6.7)', () => {
  it('returns null when below both the participant and event minimums', () => {
    const events = makeEvents(2)
    const regs = makeAttendedRegs(3, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    expect(result.score).toBeNull()
    expect(result.activeParticipants).toBe(3)
    expect(result.eventsCount).toBe(2)
  })

  it('returns null when events clear the bar but participants do not', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS)
    const regs = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS - 1, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    expect(result.score).toBeNull()
  })

  it('returns null when participants clear the bar but events do not', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS - 1)
    const regs = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    expect(result.score).toBeNull()
  })

  it('returns a real score once both minimums are met (exact boundary)', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS)
    const regs = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    expect(result.score).not.toBeNull()
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})

describe('computeDatavitaWindow — formula components', () => {
  it('D1/D2 average into the core score (Datavita_jádro = 0.5·D1 + 0.5·D2)', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS)
    const regs = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    const expectedCore = Math.round(0.5 * result.participation + 0.5 * result.organization)
    expect(result.score).toBe(expectedCore)
  })

  it('retention rate is 100% when every previous participant returns', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS)
    const regs = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))
    const prevParticipants = new Set(regs.slice(0, 5).map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, prevParticipants)

    expect(result.retentionRate).toBe(1)
  })

  it('retention rate is 0% when no previous participant returns', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS)
    const regs = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS, events)
    const profiles50Plus = new Set(regs.map((r) => r.user_id))
    const prevParticipants = new Set(['someone-who-never-came-back'])

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, prevParticipants)

    expect(result.retentionRate).toBe(0)
  })

  it('volunteer share only counts attendance at is_volunteering-tagged events', () => {
    const volunteerEvents = makeEvents(3, { volunteering: true })
    const regularEvents = makeEvents(2, { volunteering: false }).map((e) => ({ ...e, id: `plain-${e.id}` }))
    const events = [...volunteerEvents, ...regularEvents]

    const volunteerRegs: RegistrationRow[] = volunteerEvents.map((e, i) => ({
      id: `vr${i}`,
      event_id: e.id,
      user_id: `vu${i}`,
      status: 'approved',
      created_at: new Date().toISOString(),
      attendance_status: 'attended',
    }))
    const plainRegs: RegistrationRow[] = Array.from({ length: DATAVITA_MIN_PARTICIPANTS - volunteerRegs.length }, (_, i) => ({
      id: `pr${i}`,
      event_id: regularEvents[i % regularEvents.length].id,
      user_id: `pu${i}`,
      status: 'approved',
      created_at: new Date().toISOString(),
      attendance_status: 'attended',
    }))
    const regs = [...volunteerRegs, ...plainRegs]
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    expect(result.volunteerShare).toBeCloseTo(volunteerRegs.length / regs.length, 5)
  })

  it('only attended registrations count toward engagement — pending/rejected do not', () => {
    const events = makeEvents(DATAVITA_MIN_EVENTS)
    const attended = makeAttendedRegs(DATAVITA_MIN_PARTICIPANTS, events)
    const notAttended: RegistrationRow[] = Array.from({ length: 20 }, (_, i) => ({
      id: `na${i}`,
      event_id: events[i % events.length].id,
      user_id: `nau${i}`,
      status: 'pending',
      created_at: new Date().toISOString(),
      attendance_status: 'not_marked',
    }))
    const regs = [...attended, ...notAttended]
    const profiles50Plus = new Set(regs.map((r) => r.user_id))

    const result = computeDatavitaWindow(events, regs, profiles50Plus, WINDOW_START, WINDOW_END, new Set())

    expect(result.activeParticipants).toBe(DATAVITA_MIN_PARTICIPANTS)
  })
})
