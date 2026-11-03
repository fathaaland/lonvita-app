// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { buildEventsCsv } from '@/lib/analytics'
import { serializeError } from '@/lib/logger/serialize-error'

const eventTitled = (id: number, title: string) =>
  ({
    id,
    title,
    date_time: '2026-12-01T17:00:00.000Z',
    category_ids: [],
    organizer_id: 1,
    capacity: 10,
    status: 'active',
  }) as never

describe('The events CSV keeps every cell plain text', () => {
  it('defuses cells Excel would read as a formula', () => {
    const titles = ['=HYPERLINK("http://x","a")', '+1', '-1', '@SUM(1)', '\tTab']
    const csv = buildEventsCsv(titles.map((t, i) => eventTitled(i + 1, t)), [], [], [])
    const lines = csv.split('\n').slice(1)

    for (const line of lines) expect(line).toMatch(/^"'/)
    expect(lines[0].startsWith(`"'=HYPERLINK(""http://x"",""a"")",`)).toBe(true)
  })

  it('leaves an ordinary title as it is', () => {
    const csv = buildEventsCsv([eventTitled(1, 'Úklid návsi')], [], [], [])
    expect(csv.split('\n')[1].startsWith('"Úklid návsi",')).toBe(true)
  })
})

describe('A logged error keeps the query values out of its stack too', () => {
  it('redacts the params in the stack and keeps its frames', () => {
    const error = new Error('Failed query: update "users" set "reset_password_token" = $1\nparams: DUMMY-TOKEN-abc123,42')
    const serialized = serializeError(error)

    expect(serialized.errorMessage).not.toContain('DUMMY-TOKEN-abc123')
    expect(serialized.errorStack).not.toContain('DUMMY-TOKEN-abc123')
    expect(serialized.errorStack).toContain('params: [redacted]')
    expect(serialized.errorStack).toMatch(/\n\s+at /)
  })
})
