import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { notDeleted } from '@/collections/shared/softDelete'
import { organizesSomewhere, toVolunteerCards } from '@/lib/volunteers/pool'

const relId = (value: unknown): number | null =>
  value == null ? null : typeof value === 'object' ? (value as { id: number }).id : (value as number)

/**
 * A volunteer's card — what organizers look at before inviting someone, and what the volunteer sees
 * of themselves under "Dobrovolník": who they are, where they help, their ratings from organizers
 * (with comments) and the events they've helped on. Only while they're in the pool: leaving it hides
 * the card (the data stays, for when they come back). The volunteer themselves and anyone who
 * organizes may look.
 *
 * GET /api/volunteers/:userId
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const payload = await getPayload({ config })
  const { user: viewer } = await payload.auth({ headers: request.headers })
  if (!viewer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = Number((await params).userId)
  if (!userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const isSelf = viewer.id === userId
  if (!isSelf && !(await organizesSomewhere(payload, viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const profile = (
    await payload.find({
      collection: 'profiles',
      where: { and: [{ user: { equals: userId } }, { isVolunteer: { equals: true } }, notDeleted] },
      depth: 1,
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [[card], ratings, registrations] = await Promise.all([
    toVolunteerCards(payload, [profile], viewer),
    payload.find({
      collection: 'volunteer-ratings',
      where: { volunteer: { equals: userId } },
      sort: '-createdAt',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'registrations',
      where: {
        and: [
          { user: { equals: userId } },
          { role: { equals: 'volunteer' } },
          { status: { equals: 'approved' } },
          { deletedAt: { exists: false } },
        ],
      },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])

  // Who rated — the organization they run the event as reads better than a person's name, but the
  // name is what we have for everyone; one lookup for all of them.
  const raterIds = [...new Set(ratings.docs.map((r) => relId(r.ratedBy)!))]
  const raters =
    raterIds.length > 0
      ? await payload.find({
          collection: 'profiles',
          where: { user: { in: raterIds } },
          select: { user: true, fullName: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : { docs: [] }
  const raterName = new Map(raters.docs.map((p) => [relId(p.user), p.fullName]))

  const eventIds = registrations.docs.map((r) => relId(r.event)!)
  const events =
    eventIds.length > 0
      ? await payload.find({
          collection: 'events',
          where: { and: [{ id: { in: eventIds } }, { status: { not_equals: 'cancelled' } }, notDeleted] },
          select: { title: true, dateTime: true, locationText: true },
          sort: '-dateTime',
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : { docs: [] }
  const attendedEventIds = new Set(
    registrations.docs.filter((r) => r.attendanceStatus === 'attended').map((r) => relId(r.event)),
  )
  const now = Date.now()

  return NextResponse.json({
    volunteer: card,
    is_self: isSelf,
    ratings: ratings.docs.map((r) => ({
      id: String(r.id),
      rating: r.rating,
      comment: r.comment ?? null,
      event_id: String(relId(r.event)),
      event_title: r.eventTitle,
      rated_by_name: raterName.get(relId(r.ratedBy)) ?? 'Pořadatel',
      created_at: r.createdAt,
    })),
    events: events.docs.map((e) => ({
      id: String(e.id),
      title: e.title,
      date_time: e.dateTime,
      location_text: e.locationText ?? null,
      upcoming: new Date(e.dateTime).getTime() > now,
      attended: attendedEventIds.has(e.id),
    })),
  })
}
