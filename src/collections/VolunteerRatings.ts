import type { Access, CollectionBeforeValidateHook, CollectionConfig, Where } from 'payload'
import { APIError } from 'payload'

import { deletedAtField, notDeleted } from './shared/softDelete'
import { isUnlimitedCapacity } from '@/lib/capacity'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

const COMMENT_MAX_LENGTH = 500

/** The rated volunteer, and whoever organizes anywhere (the pool's audience — they weigh whom to
 * invite by it). */
const canReadRating: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  // A rating the obec removed on the volunteer's complaint (ReviewComplaints) is gone for everyone.
  if (user.role === 'admin') return notDeleted
  const organizing = await payload.count({
    collection: 'user-roles',
    where: { and: [{ user: { equals: user.id } }, { role: { in: ['municipality_admin', 'organizer'] } }] },
    overrideAccess: true,
  })
  if (organizing.totalDocs > 0) return notDeleted
  const where: Where = { and: [{ volunteer: { equals: user.id } }, notDeleted] }
  return where
}

/**
 * Everything but the stars and the comment is derived from the registration. Only for a volunteer
 * marked as attended — on an event with unlimited capacity, which keeps no attendance, any volunteer
 * still on it — once the event has started, and only by the event's own pořadatel, whoever else
 * co-organizes it (the obec included): the same person who fills in its attendance. Once, and for
 * good: a rating can't be changed afterwards (the pořadatel confirms it first).
 */
const prepareRating: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (!data) return data
  if (typeof data.comment === 'string') data.comment = data.comment.trim().slice(0, COMMENT_MAX_LENGTH) || null
  if (operation !== 'create') return data

  const { user, payload } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const registrationId = relationId(data.registration)
  const registration = registrationId
    ? await payload
        .findByID({ collection: 'registrations', id: registrationId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  if (!registration || registration.role !== 'volunteer') {
    throw new APIError('Hodnotit jde jen dobrovolníka na akci.', 400)
  }

  const eventId = relationId(registration.event)!
  const event = await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
  if (isUnlimitedCapacity(event.capacity)) {
    if (registration.status !== 'approved') {
      throw new APIError('Dobrovolník na akci nakonec nebyl — hodnotit ho nejde.', 400)
    }
  } else if (registration.attendanceStatus !== 'attended') {
    throw new APIError('Dobrovolníka ohodnotíte, až ho v docházce označíte jako přítomného.', 400)
  }
  if (new Date(event.dateTime).getTime() > Date.now()) {
    throw new APIError('Dobrovolníka ohodnotíte po akci.', 400)
  }
  if (relationId(event.organizer) !== String(user.id)) {
    throw new APIError('Dobrovolníka hodnotí jen pořadatel, který akci založil.', 403)
  }

  const existing = await payload.count({
    collection: 'volunteer-ratings',
    where: { registration: { equals: registration.id } },
    overrideAccess: true,
    req,
  })
  if (existing.totalDocs > 0) {
    throw new APIError('Dobrovolníka na téhle akci už jste ohodnotili — hodnocení změnit nejde.', 400)
  }

  return {
    registration: registration.id,
    event: Number(eventId),
    eventTitle: event.title,
    volunteer: Number(relationId(registration.user)),
    ratedBy: user.id,
    rating: data.rating,
    comment: data.comment ?? null,
  }
}

const fixedAfterCreate = { update: () => false }

/**
 * How an organizer rates a volunteer who helped on their event — 1 to 5 stars and an optional
 * note. Kept on the volunteer: their average is what organizers see on the volunteer map and on the
 * volunteer's own card. The volunteer rates the event in turn like every participant (EventFeedback).
 */
export const VolunteerRatings: CollectionConfig = {
  slug: 'volunteer-ratings',
  labels: {
    singular: 'Volunteer Rating',
    plural: 'Volunteer Ratings',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['volunteer', 'eventTitle', 'rating', 'ratedBy', 'updatedAt'],
  },
  access: {
    read: canReadRating,
    create: ({ req: { user } }) => Boolean(user),
    // Final once given — the pořadatel confirms it before saving.
    update: () => false,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'registration',
      type: 'relationship',
      relationTo: 'registrations',
      required: true,
      unique: true,
      access: fixedAfterCreate,
    },
    { name: 'event', type: 'relationship', relationTo: 'events', required: true, access: fixedAfterCreate },
    { name: 'eventTitle', type: 'text', required: true, access: fixedAfterCreate },
    { name: 'volunteer', type: 'relationship', relationTo: 'users', required: true, access: fixedAfterCreate },
    { name: 'ratedBy', type: 'relationship', relationTo: 'users', required: true, access: fixedAfterCreate },
    { name: 'rating', type: 'number', required: true, min: 1, max: 5 },
    { name: 'comment', type: 'textarea', maxLength: COMMENT_MAX_LENGTH },
    deletedAtField,
  ],
  hooks: {
    beforeValidate: [prepareRating],
  },
  timestamps: true,
}
