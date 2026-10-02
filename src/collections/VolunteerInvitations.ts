import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { eventOrganizerIds, mayEditEvent } from './Events'
import { escapeHtml, sendNotification } from './shared/notify'
import { scheduleParticipantReminder } from './shared/reminders'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** How long a note to the volunteer may be. */
const MESSAGE_MAX_LENGTH = 500

/** The volunteer, whoever invited them, the event's organizers (to see who's been asked already),
 * an admin of its obec and a platform admin. */
const canReadInvitation: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  const managedEventsWhere: Where[] = [{ organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }]
  if (administeredIds.length > 0) managedEventsWhere.push({ municipality: { in: administeredIds } })
  const managed = await payload.find({
    collection: 'events',
    where: { or: managedEventsWhere },
    select: { organizer: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })

  const or: Where[] = [{ volunteer: { equals: user.id } }, { invitedBy: { equals: user.id } }]
  if (managed.docs.length > 0) or.push({ event: { in: managed.docs.map((e) => e.id) } })
  const where: Where = { or }
  return where
}

/** Only the volunteer answers their invitation (a platform admin aside). Withdrawing is the
 * system's — when the volunteer leaves the pool (Profiles). */
const canDecideInvitation: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const where: Where = { volunteer: { equals: user.id } }
  return where
}

/**
 * Everything about a new invitation is derived from the event, the volunteer and the signed-in
 * user — the client names the first two and may add a note. Whoever may edit the event invites
 * (with the obec on it, that's only its admins — Events lockedEventIds), only someone in the pool,
 * only for an event that hasn't started, and nobody already on it.
 */
const prepareInvitation: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data
  const { user, payload } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const eventId = relationId(data.event)
  const event = eventId
    ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req }).catch(() => null)
    : null
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce neexistuje nebo už byla zrušena.', 404)
  }
  if (new Date(event.dateTime).getTime() <= Date.now()) {
    throw new APIError('Akce už začala — dobrovolníky na ni zvát nejde.', 400)
  }
  if (!(await mayEditEvent(req, user, event))) {
    throw new APIError('Dobrovolníky může zvát jen ten, kdo smí akci upravovat.', 403)
  }

  const volunteerId = relationId(data.volunteer)
  const profile = volunteerId
    ? (
        await payload.find({
          collection: 'profiles',
          where: { user: { equals: volunteerId } },
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
        })
      ).docs[0]
    : undefined
  if (!profile?.isVolunteer || profile.deletedAt) {
    throw new APIError('Tenhle člověk není v poolu dobrovolníků.', 400)
  }
  if (eventOrganizerIds(event).includes(volunteerId!)) {
    throw new APIError('Pořadatel akce na ni dobrovolníkem být nemůže — pořádá ji.', 400)
  }

  const [registered, pending] = await Promise.all([
    payload.count({
      collection: 'registrations',
      where: {
        and: [
          { event: { equals: event.id } },
          { user: { equals: volunteerId } },
          { status: { in: ['pending', 'approved'] } },
        ],
      },
      overrideAccess: true,
      req,
    }),
    payload.count({
      collection: 'volunteer-invitations',
      where: {
        and: [{ event: { equals: event.id } }, { volunteer: { equals: volunteerId } }, { status: { equals: 'pending' } }],
      },
      overrideAccess: true,
      req,
    }),
  ])
  if (registered.totalDocs > 0) throw new APIError('Na akci už je přihlášený.', 400)
  if (pending.totalDocs > 0) throw new APIError('Pozvánka pro tohoto dobrovolníka už čeká na odpověď.', 400)

  const message = typeof data.message === 'string' ? data.message.trim().slice(0, MESSAGE_MAX_LENGTH) : ''
  return {
    event: event.id,
    eventTitle: event.title,
    volunteer: Number(volunteerId),
    invitedBy: user.id,
    message: message || null,
    status: 'pending',
  }
}

/**
 * A decision is final. Accepting puts the volunteer on the event in the same transaction — an
 * approved registration with the "volunteer" role, which uses up no participant's spot — so an
 * accepted invitation always has its registration. Withdrawing is the system's alone
 * (`context.withdrawingVolunteerInvitations`, when the volunteer leaves the pool).
 */
const applyDecision: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (operation !== 'update' || !data || !originalDoc || data.status === undefined) return data
  if (data.status === originalDoc.status) return data
  if (originalDoc.status !== 'pending') throw new APIError('O pozvánce už bylo rozhodnuto.', 409)
  if (data.status === 'withdrawn' && !req.context?.withdrawingVolunteerInvitations && req.user?.role !== 'admin') {
    throw new APIError('Pozvánku můžete jen přijmout, nebo odmítnout.', 400)
  }

  data.decidedAt = new Date().toISOString()
  if (data.status !== 'accepted') return data

  const eventId = relationId(originalDoc.event)!
  const volunteerId = Number(relationId(originalDoc.volunteer))
  const event = await req.payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce už byla zrušena — pozvánku můžete jen odmítnout.', 409)
  }
  if (new Date(event.dateTime).getTime() <= Date.now()) {
    throw new APIError('Akce už začala — pozvánku už přijmout nejde.', 409)
  }

  // Someone who registered as a participant meanwhile becomes the volunteer instead.
  const existing = (
    await req.payload.find({
      collection: 'registrations',
      where: {
        and: [{ event: { equals: eventId } }, { user: { equals: volunteerId } }, { status: { in: ['pending', 'approved'] } }],
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
  ).docs[0]
  const registration = existing
    ? await req.payload.update({
        collection: 'registrations',
        id: existing.id,
        data: { role: 'volunteer', status: 'approved' },
        overrideAccess: true,
        context: { volunteerInvitation: true },
        req,
      })
    : await req.payload.create({
        collection: 'registrations',
        data: { event: Number(eventId), user: volunteerId, role: 'volunteer', status: 'approved' },
        overrideAccess: true,
        context: { volunteerInvitation: true },
        req,
      })
  data.registration = registration.id
  return data
}

const notifyOnInvitationChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
  const { payload } = req
  const eventId = relationId(doc.event)!
  const volunteerId = relationId(doc.volunteer)!
  const inviterId = relationId(doc.invitedBy)!
  const title = escapeHtml(doc.eventTitle)

  const nameOf = async (userId: string, fallback: string) =>
    (
      await payload.find({
        collection: 'profiles',
        where: { user: { equals: userId } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
      })
    ).docs[0]?.fullName || fallback

  if (operation === 'create') {
    const inviter = await nameOf(inviterId, 'Pořadatel')
    const note = doc.message ? ` Vzkaz: „${doc.message}“` : ''
    sendNotification(payload, {
      userId: volunteerId,
      title: 'Pozvánka k dobrovolnické pomoci',
      link: '/profil',
      message: `${inviter} vás zve, abyste pomohli na akci „${doc.eventTitle}“.${note}`,
      email: {
        subject: `Pozvánka k dobrovolnické pomoci: ${doc.eventTitle}`,
        body:
          `<p>${escapeHtml(inviter)} vás zve, abyste pomohli na akci <strong>${title}</strong>.</p>` +
          (doc.message ? `<p>„${escapeHtml(doc.message)}“</p>` : '') +
          `<p>Pozvánku přijmete nebo odmítnete v profilu, v sekci Pool dobrovolníků.</p>`,
      },
    })
    return doc
  }

  if (operation !== 'update' || doc.status === previousDoc?.status) return doc
  // A withdrawal is announced by whoever withdrew (Profiles, leaving the pool).
  if (doc.status === 'withdrawn' || context?.withdrawingVolunteerInvitations) return doc

  const volunteer = await nameOf(volunteerId, 'Dobrovolník')
  const accepted = doc.status === 'accepted'
  sendNotification(payload, {
    userId: inviterId,
    title: accepted ? 'Dobrovolník přijal pozvánku' : 'Dobrovolník pozvánku odmítl',
    link: accepted ? `/spravovat/${eventId}` : `/akce/${eventId}`,
    message: accepted
      ? `${volunteer} pomůže na akci „${doc.eventTitle}“.`
      : `${volunteer} na akci „${doc.eventTitle}“ pomáhat nebude.`,
  })

  if (accepted && doc.registration) {
    try {
      const event = await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
      await scheduleParticipantReminder(payload, relationId(doc.registration)!, volunteerId, event)
    } catch (error) {
      payload.logger.error(`Failed to schedule reminder for volunteer invitation ${doc.id}: ${error}`)
    }
  }
  return doc
}

const fixedAfterCreate = { update: () => false }

/**
 * An organizer asking someone from the volunteer pool to help run an event (brief §7 "Pool
 * dobrovolníků"). The pool itself only says "you may reach out to me"; this is the commitment for
 * one event, and it takes the volunteer's own yes: accepting makes them a volunteer on the event
 * (Registrations.role). Leaving the pool withdraws what's still pending and tells the organizers of
 * the events they help on (Profiles).
 */
export const VolunteerInvitations: CollectionConfig = {
  slug: 'volunteer-invitations',
  labels: {
    singular: 'Volunteer Invitation',
    plural: 'Volunteer Invitations',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['eventTitle', 'volunteer', 'invitedBy', 'status', 'updatedAt'],
  },
  access: {
    read: canReadInvitation,
    create: ({ req: { user } }) => Boolean(user),
    update: canDecideInvitation,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    { name: 'event', type: 'relationship', relationTo: 'events', required: true, access: fixedAfterCreate },
    { name: 'eventTitle', type: 'text', required: true, access: fixedAfterCreate },
    { name: 'volunteer', type: 'relationship', relationTo: 'users', required: true, access: fixedAfterCreate },
    { name: 'invitedBy', type: 'relationship', relationTo: 'users', required: true, access: fixedAfterCreate },
    {
      name: 'message',
      type: 'textarea',
      maxLength: MESSAGE_MAX_LENGTH,
      access: fixedAfterCreate,
      admin: { description: "The organizer's note — what they need help with." },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Accepted', value: 'accepted' },
        { label: 'Declined', value: 'declined' },
        { label: 'Withdrawn', value: 'withdrawn' },
      ],
    },
    {
      // Set when accepted — the volunteer's registration on the event.
      name: 'registration',
      type: 'relationship',
      relationTo: 'registrations',
      access: { create: () => false, update: () => false },
      admin: { readOnly: true, position: 'sidebar' },
    },
    { name: 'decidedAt', type: 'date', admin: { position: 'sidebar' } },
  ],
  hooks: {
    beforeValidate: [prepareInvitation],
    beforeChange: [applyDecision],
    afterChange: [notifyOnInvitationChange],
  },
  timestamps: true,
}
