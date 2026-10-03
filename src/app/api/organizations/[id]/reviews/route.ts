import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { notDeleted } from '@/collections/shared/softDelete'
import { canAccessOrganization } from '@/lib/exports/access'
import { findOrganizationEvents } from '@/lib/organization-feedback'
import { complainantContext, complaintStatusByReview, mayComplainAbout } from '@/lib/review-complaints'

const relationId = (value: unknown): number | null =>
  value == null ? null : typeof value === 'object' ? (value as { id: number }).id : (value as number)

/**
 * The individual reviews participants left on the organization's events — the stars and the comment,
 * never who wrote them (the registration and its user stay out of the response), so the organizer
 * can read what was said and report a review to the obec. Newest first. Removed reviews are gone.
 * For the same people as the feedback summary.
 *
 * GET /api/organizations/:id/reviews
 * → { docs: [{ id, event_id, event_title, event_date, satisfaction, felt_welcome, comment, created_at,
 *              complaint_status: 'pending' | 'rejected' | null, can_complain }] }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessOrganization(payload, user, id)
  if (access === 'missing') return NextResponse.json({ error: 'Organizace neexistuje.' }, { status: 404 })
  if (access === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const events = await findOrganizationEvents(payload, id)
  if (events.length === 0) return NextResponse.json({ docs: [] })
  const eventById = new Map(events.map((e) => [e.id, e]))

  const feedback = await payload.find({
    collection: 'event-feedback',
    where: { and: [{ 'registration.event': { in: [...eventById.keys()] } }, notDeleted] },
    sort: '-createdAt',
    depth: 1,
    pagination: false,
    overrideAccess: true,
  })

  const [statuses, ctx] = await Promise.all([
    complaintStatusByReview(
      payload,
      'event-feedback',
      feedback.docs.map((f) => f.id),
    ),
    complainantContext(payload, user),
  ])

  const docs = feedback.docs.flatMap((f) => {
    const registration = typeof f.registration === 'object' ? f.registration : null
    const event = eventById.get(relationId(registration?.event)!)
    if (!event) return []
    const status = statuses.get(String(f.id)) ?? null
    return [
      {
        id: String(f.id),
        event_id: String(event.id),
        event_title: event.title,
        event_date: event.dateTime,
        satisfaction: f.satisfactionRating,
        felt_welcome: f.feltWelcomeRating ?? null,
        comment: f.comment?.trim() || null,
        created_at: f.createdAt,
        complaint_status: status,
        can_complain: status === null && mayComplainAbout({ type: 'event-feedback', event, volunteerId: null }, ctx),
      },
    ]
  })

  return NextResponse.json({ docs })
}
