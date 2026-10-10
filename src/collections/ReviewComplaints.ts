import type { CollectionAfterChangeHook, CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canReadOwnOrAdministered } from './access/shared'
import { escapeHtml, getObecDeciders, sendNotificationToMany } from './shared/notify'
import {
  complainantContext,
  complaintStatusByReview,
  mayComplainAbout,
  resolveReview,
  type ReviewType,
} from '@/lib/review-complaints'
import { REVIEW_COMPLAINT_REASON_MAX_LENGTH, REVIEW_COMPLAINT_REASON_MIN_LENGTH } from '@/lib/validation'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * The client names only the review and the reason — everything else is derived from the review and
 * the signed-in user. One complaint per review: not while one is waiting on the obec, and not again
 * once the obec kept the review.
 */
const prepareComplaint: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data
  const { user, payload } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const type = data.reviewType as ReviewType | undefined
  if (type !== 'event-feedback' && type !== 'volunteer-rating') throw new APIError('Chybí recenze.', 400)
  const reviewId = relationId(type === 'event-feedback' ? data.eventFeedback : data.volunteerRating)

  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  if (reason.length < REVIEW_COMPLAINT_REASON_MIN_LENGTH) {
    throw new APIError(`Napište, co je na recenzi špatně (aspoň ${REVIEW_COMPLAINT_REASON_MIN_LENGTH} znaků).`, 400)
  }
  if (reason.length > REVIEW_COMPLAINT_REASON_MAX_LENGTH) {
    throw new APIError(`Zdůvodnění může mít nejvýš ${REVIEW_COMPLAINT_REASON_MAX_LENGTH} znaků.`, 400)
  }

  const review = reviewId ? await resolveReview(payload, type, reviewId, req) : null
  if (!review) throw new APIError('Recenze neexistuje nebo už byla odstraněna.', 404)
  if (!mayComplainAbout(review, await complainantContext(payload, user))) {
    throw new APIError('Tuhle recenzi nahlásit nemůžete.', 403)
  }

  const existing = (await complaintStatusByReview(payload, type, [review.id], req)).get(String(review.id))
  if (existing === 'pending') throw new APIError('Stížnost na tuhle recenzi už čeká na posouzení obcí.', 400)
  if (existing === 'rejected') {
    throw new APIError('Obec už stížnost na tuhle recenzi posoudila a recenzi ponechala.', 400)
  }

  return {
    reviewType: type,
    eventFeedback: type === 'event-feedback' ? review.id : null,
    volunteerRating: type === 'volunteer-rating' ? review.id : null,
    event: review.event.id,
    municipality: Number(relationId(review.event.municipality)),
    complainant: user.id,
    reason,
    status: 'pending',
  }
}

/** A new complaint goes to the admins of the obec the event belongs to — they decide it (the
 * platform admins, for an obec without one). */
const notifyObecOfComplaint: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return
  try {
    const event = await req.payload
      .findByID({ collection: 'events', id: relationId(doc.event)!, depth: 0, overrideAccess: true })
      .catch(() => null)
    const title = event?.title ?? 'akce'
    const what = doc.reviewType === 'volunteer-rating' ? 'hodnocení dobrovolníka' : 'recenzi akce'
    const { userIds: adminIds, requestsLink } = await getObecDeciders(req.payload, relationId(doc.municipality)!)
    sendNotificationToMany(req.payload, adminIds, {
      title: 'Nová stížnost na recenzi',
      link: requestsLink,
      message: `Někdo nahlásil ${what} „${title}“. Posuďte, jestli recenzi odstranit.`,
      email: {
        subject: 'Nová stížnost na recenzi',
        body: `<p>Někdo nahlásil ${what} <strong>${escapeHtml(title)}</strong>. Posuďte to v sekci Žádosti.</p>`,
      },
    })
  } catch (error) {
    req.payload.logger.error(`Failed to notify about review complaint ${doc.id}: ${error}`)
  }
}

/**
 * An organizer's or volunteer's complaint about a review of them — event feedback from a
 * participant, or an organizer's rating of a volunteer. The obec the event belongs to decides it
 * (POST /api/review-complaints/:id/decide): upholding it removes the review (soft delete), which
 * drops it from every average computed from the reviews.
 */
export const ReviewComplaints: CollectionConfig = {
  slug: 'review-complaints',
  labels: {
    singular: 'Review Complaint',
    plural: 'Review Complaints',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['reviewType', 'event', 'complainant', 'status', 'createdAt'],
  },
  access: {
    read: canReadOwnOrAdministered('complainant', 'municipality'),
    create: ({ req: { user } }) => Boolean(user),
    // Decided only through the decide endpoint, which removes the review in the same transaction.
    update: () => false,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'reviewType',
      type: 'select',
      required: true,
      options: [
        { label: 'Event feedback', value: 'event-feedback' },
        { label: 'Volunteer rating', value: 'volunteer-rating' },
      ],
    },
    // Nullable on purpose: the review can go with its author's account or its event, the complaint
    // (and what the obec decided) stays.
    { name: 'eventFeedback', type: 'relationship', relationTo: 'event-feedback', index: true },
    { name: 'volunteerRating', type: 'relationship', relationTo: 'volunteer-ratings', index: true },
    { name: 'event', type: 'relationship', relationTo: 'events' },
    { name: 'municipality', type: 'relationship', relationTo: 'municipalities', required: true, index: true },
    { name: 'complainant', type: 'relationship', relationTo: 'users', required: true },
    { name: 'reason', type: 'textarea', required: true, maxLength: REVIEW_COMPLAINT_REASON_MAX_LENGTH },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Upheld (review removed)', value: 'upheld' },
        { label: 'Rejected (review kept)', value: 'rejected' },
      ],
    },
    { name: 'decidedBy', type: 'relationship', relationTo: 'users', admin: { position: 'sidebar' } },
    { name: 'decidedAt', type: 'date', admin: { position: 'sidebar' } },
    { name: 'decisionNote', type: 'textarea', admin: { description: "The obec's reasoning, shown to the complainant." } },
  ],
  hooks: {
    beforeValidate: [prepareComplaint],
    afterChange: [notifyObecOfComplaint],
  },
  timestamps: true,
}
