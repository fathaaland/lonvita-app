import { NextResponse } from 'next/server'
import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'

import config from '@payload-config'
import { escapeHtml, sendNotification } from '@/collections/shared/notify'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { canAccessMunicipality } from '@/lib/exports/access'
import { logger, serializeError } from '@/lib/logger'

const DECISION_NOTE_MAX_LENGTH = 500

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * The obec decides a complaint about a review (ReviewComplaints): upholding it removes the review —
 * soft-deleted, in the same transaction that closes the complaint — so every average computed from
 * the reviews drops it; rejecting keeps the review, and it can't be reported again. Whoever
 * complained hears the outcome. The review's author is not told, so the complaint stays discreet.
 * For an admin of the event's obec, or a platform admin.
 *
 * POST /api/review-complaints/:id/decide  { uphold: boolean, note?: string }
 * → { status: 'upheld' | 'rejected' }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { uphold?: unknown; note?: unknown } | null
  if (typeof body?.uphold !== 'boolean') {
    return NextResponse.json({ error: 'Chybí rozhodnutí.' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note.length > DECISION_NOTE_MAX_LENGTH) {
    return NextResponse.json({ error: `Zdůvodnění může mít nejvýš ${DECISION_NOTE_MAX_LENGTH} znaků.` }, { status: 400 })
  }

  const complaint = await payload
    .findByID({ collection: 'review-complaints', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!complaint) return NextResponse.json({ error: 'Stížnost neexistuje.' }, { status: 404 })

  const municipalityId = relationId(complaint.municipality)
  if (!municipalityId || !(await canAccessMunicipality(payload, user, municipalityId))) {
    return NextResponse.json({ error: 'O téhle stížnosti nerozhodujete.' }, { status: 403 })
  }
  if (complaint.status !== 'pending') {
    return NextResponse.json({ error: 'O stížnosti už bylo rozhodnuto.' }, { status: 409 })
  }

  const status = body.uphold ? 'upheld' : 'rejected'
  const decidedAt = new Date().toISOString()
  const isRating = complaint.reviewType === 'volunteer-rating'
  const reviewId = relationId(isRating ? complaint.volunteerRating : complaint.eventFeedback)

  const req = await createLocalReq({ user }, payload)
  const shouldCommit = await initTransaction(req)
  try {
    if (body.uphold && reviewId) {
      await payload.update({
        collection: isRating ? 'volunteer-ratings' : 'event-feedback',
        id: reviewId,
        data: { deletedAt: decidedAt },
        overrideAccess: true,
        req,
      })
    }
    await payload.update({
      collection: 'review-complaints',
      id: complaint.id,
      data: { status, decidedBy: user.id, decidedAt, decisionNote: note || null },
      overrideAccess: true,
      req,
    })
    if (shouldCommit) await commitTransaction(req)
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    logger.error('Review complaint decision failed', {
      event: 'review_complaints.decision_failed',
      complaintId: complaint.id,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Stížnost se nepodařilo vyřídit.' }, { status: 500 })
  }

  writeAuditLog(payload, {
    action: `review-complaints.${status}`,
    actor: user.id,
    targetCollection: 'review-complaints',
    targetId: complaint.id,
    metadata: { reviewType: complaint.reviewType, reviewId, note: note || null },
  })

  const eventId = relationId(complaint.event)
  const event = eventId
    ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }).catch(() => null)
    : null
  const title = event?.title ?? 'akce'
  const complainantId = relationId(complaint.complainant)!
  const what = isRating ? 'hodnocení z akce' : 'recenzi akce'
  const reasoning = note ? ` Zdůvodnění obce: ${note}` : ''
  sendNotification(payload, {
    userId: complainantId,
    title: body.uphold ? 'Recenze odstraněna' : 'Stížnost na recenzi zamítnuta',
    link: isRating ? `/dobrovolnik/${complainantId}` : '/organizace',
    message: body.uphold
      ? `Obec vaší stížnosti vyhověla a ${what} „${title}“ odstranila. Hodnocení se přepočítalo.${reasoning}`
      : `Obec posoudila vaši stížnost na ${what} „${title}“ a recenzi ponechala.${reasoning}`,
    email: {
      subject: body.uphold ? 'Recenze odstraněna' : 'Stížnost na recenzi zamítnuta',
      body: body.uphold
        ? `<p>Obec vaší stížnosti vyhověla a ${what} <strong>${escapeHtml(title)}</strong> odstranila. Hodnocení se přepočítalo.</p>${note ? `<p>Zdůvodnění obce: ${escapeHtml(note)}</p>` : ''}`
        : `<p>Obec posoudila vaši stížnost na ${what} <strong>${escapeHtml(title)}</strong> a recenzi ponechala.</p>${note ? `<p>Zdůvodnění obce: ${escapeHtml(note)}</p>` : ''}`,
    },
  })

  return NextResponse.json({ status })
}
