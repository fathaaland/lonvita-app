import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { hasEventEnded } from '@/lib/eventEnded'
import { isRegistrationOpen } from '@/lib/registrationCutoff'

const relId = (value: unknown) => String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * How to reach the event's pořadatel (who founded it) — for whoever can no longer sign up for it, or
 * cancel their registration, in the app (less than REGISTRATION_CUTOFF_HOURS before the start) and is
 * asked to call or e-mail them instead. So: anyone signed in from that cut-off until the event is over,
 * and before it only whoever holds an active (pending/approved) registration on it — the organizer's
 * phone isn't public otherwise (Profiles canReadPhone).
 *
 * GET /api/events/:id/organizer-contact
 * → { name: string | null, email: string | null, phone: string | null }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') {
    return NextResponse.json({ error: 'Akce neexistuje nebo už byla zrušena.' }, { status: 404 })
  }

  const signUpClosed = !isRegistrationOpen(event.dateTime) && !hasEventEnded(event.dateTime, event.endDateTime)
  const registered = await payload.count({
    collection: 'registrations',
    where: {
      and: [
        { event: { equals: event.id } },
        { user: { equals: user.id } },
        { status: { in: ['pending', 'approved'] } },
        { deletedAt: { exists: false } },
      ],
    },
    overrideAccess: true,
  })
  if (!signUpClosed && registered.totalDocs === 0) {
    return NextResponse.json(
      { error: 'Kontakt na pořadatele vidí jen přihlášení na akci, nebo všichni až po uzávěrce přihlášek.' },
      { status: 403 },
    )
  }

  const organizerId = relId(event.organizer)
  const [organizer, profile] = await Promise.all([
    payload.findByID({ collection: 'users', id: organizerId, depth: 0, overrideAccess: true }).catch(() => null),
    payload.find({
      collection: 'profiles',
      where: { user: { equals: organizerId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    }),
  ])
  return NextResponse.json({
    name: profile.docs[0]?.fullName?.trim() || null,
    email: organizer?.email ?? null,
    phone: profile.docs[0]?.phone?.trim() || null,
  })
}
