import type { Access, CollectionBeforeValidateHook, CollectionConfig, Where } from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { eventOrganizerIds } from './Events'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

const COMMENT_MAX_LENGTH = 500

/** The rated volunteer, and whoever organizes anywhere (the pool's audience — they weigh whom to
 * invite by it). */
const canReadRating: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const organizing = await payload.count({
    collection: 'user-roles',
    where: { and: [{ user: { equals: user.id } }, { role: { in: ['municipality_admin', 'organizer'] } }] },
    overrideAccess: true,
  })
  if (organizing.totalDocs > 0) return true
  const where: Where = { volunteer: { equals: user.id } }
  return where
}

/** Whoever gave the rating may change it. */
const canUpdateRating: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const where: Where = { ratedBy: { equals: user.id } }
  return where
}

/**
 * Everything but the stars and the comment is derived from the registration. Only for a volunteer
 * the event's people marked as attended, once the event has started, and only by someone running
 * it: its organizers, an admin of its obec, a platform admin. One rating per volunteer and event.
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
  if (registration.attendanceStatus !== 'attended') {
    throw new APIError('Dobrovolníka ohodnotíte, až ho v docházce označíte jako přítomného.', 400)
  }

  const eventId = relationId(registration.event)!
  const event = await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
  if (new Date(event.dateTime).getTime() > Date.now()) {
    throw new APIError('Dobrovolníka ohodnotíte po akci.', 400)
  }
  if (user.role !== 'admin') {
    const isOrganizer = eventOrganizerIds(event).includes(String(user.id))
    const isObecAdmin = (await getAdministeredMunicipalityIds(payload, user.id)).includes(
      relationId(event.municipality) ?? '',
    )
    if (!isOrganizer && !isObecAdmin) {
      throw new APIError('Dobrovolníka hodnotí pořadatel akce.', 403)
    }
  }

  const existing = await payload.count({
    collection: 'volunteer-ratings',
    where: { registration: { equals: registration.id } },
    overrideAccess: true,
    req,
  })
  if (existing.totalDocs > 0) throw new APIError('Dobrovolníka na téhle akci už někdo ohodnotil.', 400)

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
    update: canUpdateRating,
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
  ],
  hooks: {
    beforeValidate: [prepareRating],
  },
  timestamps: true,
}
