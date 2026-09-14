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
  const result = await payload.find({
    collection: 'registrations',
    where: {
      and: [
        { event: { in: eventIds } },
        { status: { in: ['pending', 'approved'] } },
        { deletedAt: { exists: false } },
      ],
    },
    select: { event: true, status: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const counts: RegistrationCounts = {}
  for (const reg of result.docs) {
    const eventId = String(typeof reg.event === 'object' ? reg.event.id : reg.event)
    counts[eventId] ??= { approved: 0, pending: 0 }
    if (reg.status === 'approved' || reg.status === 'pending') counts[eventId][reg.status] += 1
  }

  return NextResponse.json({ counts })
}
