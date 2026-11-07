import { sql } from '@payloadcms/db-postgres'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'

export type RegistrationCounts = Record<string, { approved: number; pending: number }>

/**
 * Participant counts per event — public, because the event list and detail page show
 * "X / kapacita" and free spots to everyone, signed-out visitors included. The registrations
 * themselves (who is going) are restricted to the event's organizer and the obec's admin
 * (Registrations.access.read), so counts can't be derived client-side from that collection.
 *
 * GET /api/events/registration-counts?event=1&event=2
 */
export async function GET(request: Request) {
  const eventIds = new URL(request.url).searchParams
    .getAll('event')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 500)

  if (eventIds.length === 0) return NextResponse.json({ counts: {} })

  const payload = await getPayload({ config })
  // Counted in the database (the rows themselves used to be fetched and summed here) — a popular
  // event has hundreds of registrations and this runs for every visitor of the listing.
  // `role IS DISTINCT FROM 'volunteer'` is PARTICIPANTS_ONLY (Registrations.ts).
  const { rows } = await payload.db.drizzle.execute<{ event_id: number; status: string; n: string }>(sql`
    SELECT event_id, status, COUNT(*) AS n
    FROM registrations
    WHERE event_id IN (${sql.join(
      eventIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND status IN ('pending', 'approved')
      AND deleted_at IS NULL
      AND role IS DISTINCT FROM 'volunteer'
    GROUP BY event_id, status
  `)

  const counts: RegistrationCounts = {}
  for (const row of rows) {
    const eventId = String(row.event_id)
    counts[eventId] ??= { approved: 0, pending: 0 }
    if (row.status === 'approved' || row.status === 'pending') counts[eventId][row.status] = Number(row.n)
  }

  // A few seconds on the CDN take a burst of visitors off the database; the event detail gets its
  // live numbers from the capacity stream (api/events/[id]/capacity-stream) anyway.
  return NextResponse.json(
    { counts },
    { headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30' } },
  )
}
