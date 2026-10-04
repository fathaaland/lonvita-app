import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  PayloadRequest,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { isRegistrationOpen, REGISTRATION_CUTOFF_HOURS } from '@/lib/registrationCutoff'

import { getAdministeredMunicipalityIds } from './access/shared'
import { isEventCreator } from './Events'
import { escapeHtml, getEventTeamUserIds, sendNotification, sendNotificationToMany } from './shared/notify'
import { scheduleParticipantReminder } from './shared/reminders'
import { notDeleted } from './shared/softDelete'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** How long a note between the organizer and the volunteer may be. */
const MESSAGE_MAX_LENGTH = 500

/** The volunteer, whoever invited them, the event's organizers (to see who's been asked already,
 * and who offered to help), an admin of its obec and a platform admin. */
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

/** Who may touch a pending row — the other side of it. An invitation is answered by the volunteer;
 * an application by the event's creator (`invitedBy`), and the volunteer may take theirs back.
 * applyDecision says which status each of them may set. Withdrawing an invitation is the
 * system's — when the volunteer leaves the pool (Profiles). */
const canDecideInvitation: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const where: Where = {
    or: [
      { and: [{ kind: { not_equals: 'application' } }, { volunteer: { equals: user.id } }] },
      {
        and: [
          { kind: { equals: 'application' } },
          { or: [{ invitedBy: { equals: user.id } }, { volunteer: { equals: user.id } }] },
        ],
      },
    ],
  }
  return where
}

type EventForInvitation = {
  id: number
  title: string
  dateTime: string
  deletedAt?: string | null
  status?: string | null
  isVolunteering?: boolean | null
  organizer: unknown
  coOrganizers?: unknown[] | null
  organization?: unknown
  coOrganizations?: unknown[] | null
  municipality?: unknown
}

/** What already stands between this volunteer and this event — a registration, or another
 * invitation/application still waiting. `asVolunteer` words it for the volunteer themselves. */
async function assertFreeToJoin(
  req: PayloadRequest,
  event: EventForInvitation,
  volunteerId: string,
  asVolunteer: boolean,
): Promise<void> {
  const { payload } = req
  const [registrations, pending] = await Promise.all([
    payload.find({
      collection: 'registrations',
      where: {
        and: [
          { event: { equals: event.id } },
          { user: { equals: volunteerId } },
          { status: { in: ['pending', 'approved', 'rejected'] } },
        ],
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    }),
    payload.find({
      collection: 'volunteer-invitations',
      where: {
        and: [{ event: { equals: event.id } }, { volunteer: { equals: volunteerId } }, { status: { equals: 'pending' } }],
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    }),
  ])

  const registration = registrations.docs[0]
  if (registration?.status === 'rejected') {
    throw new APIError(
      asVolunteer ? 'Pořadatel vás z téhle akce odhlásil — znovu se přihlásit nejde.' : 'Pořadatel ho z akce odhlásil.',
      400,
    )
  }
  if (registration) throw new APIError(asVolunteer ? 'Na akci už jste přihlášení.' : 'Na akci už je přihlášený.', 400)

  const waiting = pending.docs[0]
  if (!waiting) return
  if (waiting.kind === 'application') {
    throw new APIError(
      asVolunteer
        ? 'Vaše nabídka pomoci už čeká na pořadatele.'
        : 'Dobrovolník se na akci už sám nabídl — jeho nabídku najdete ve správě akce.',
      400,
    )
  }
  throw new APIError(
    asVolunteer
      ? 'Pořadatel vás na akci už pozval — pozvánku přijmete na stránce akce nebo v profilu.'
      : 'Pozvánka pro tohoto dobrovolníka už čeká na odpověď.',
    400,
  )
}

/**
 * Everything about a new row is derived from the event, the volunteer and the signed-in user — the
 * client names the event (and, for an invitation, the volunteer) and may add a note. Two ways to the
 * same commitment:
 * - an invitation: only the event's creator invites — not its spolupořadatelé, not the obec
 *   co-organizing it (Events isEventCreator) — someone from the pool, who then answers;
 * - an application: someone from the pool offers to help on an event flagged as volunteering
 *   (Events.isVolunteering), and the creator answers — they may weigh the volunteer's ratings first.
 * Either way only for an event that hasn't started, and nobody already on it or waiting on it.
 */
const prepareInvitation: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data

  const { user, payload } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const application = data.kind === 'application'
  const eventId = relationId(data.event)
  const event = (
    eventId
      ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req }).catch(() => null)
      : null
  ) as EventForInvitation | null
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce neexistuje nebo už byla zrušena.', 404)
  }
  if (new Date(event.dateTime).getTime() <= Date.now()) {
    throw new APIError(
      application ? 'Akce už začala — pomoc na ni nabídnout nejde.' : 'Akce už začala — dobrovolníky na ni zvát nejde.',
      400,
    )
  }
  if (application) {
    if (!event.isVolunteering) throw new APIError('Na tuhle akci pořadatel dobrovolníky nehledá.', 400)
    // Like signing up as a participant (Registrations guardRegistrationWindow) — offering help closes
    // REGISTRATION_CUTOFF_HOURS before the start; after that it's a call or e-mail to the organizer.
    if (!isRegistrationOpen(event.dateTime)) {
      throw new APIError(
        `Pomoc lze nabídnout nejpozději ${REGISTRATION_CUTOFF_HOURS} hodiny před začátkem akce — zavolejte nebo napište pořadateli.`,
        400,
      )
    }
  } else if (!isEventCreator(user, event)) {
    throw new APIError('Dobrovolníky na akci může zvát jen ten, kdo ji založil.', 403)
  }

  // An application is always the signed-in person's own offer.
  const volunteerId = application ? String(user.id) : relationId(data.volunteer)
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
    throw new APIError(
      application
        ? 'Pomoc nabízí jen dobrovolníci z poolu — přidat se můžete v profilu.'
        : 'Tenhle člověk není v poolu dobrovolníků.',
      400,
    )
  }
  // Whoever runs the event — the obec's admins too, when the obec runs or co-organizes it — takes
  // part in it automatically (Events releasePlacesOfTeam).
  if ((await getEventTeamUserIds(payload, event, { req })).includes(volunteerId!)) {
    throw new APIError(
      application ? 'Tuhle akci pořádáte — dobrovolníkem na ní být nemůžete.' : 'Pořadatel akce na ni dobrovolníkem být nemůže — pořádá ji.',
      400,
    )
  }
  await assertFreeToJoin(req, event, volunteerId!, application)

  const message = typeof data.message === 'string' ? data.message.trim().slice(0, MESSAGE_MAX_LENGTH) : ''
  return {
    kind: application ? 'application' : 'invitation',
    event: event.id,
    eventTitle: event.title,
    volunteer: Number(volunteerId),
    // The organizer's side: whoever invited — or, for an application, the creator who answers it.
    invitedBy: application ? Number(relationId(event.organizer)) : user.id,
    message: message || null,
    status: 'pending',
  }
}

/**
 * A decision is final. An invitation is answered by the volunteer; an application by the event's
 * creator, while the volunteer may withdraw it. Withdrawing an invitation is the system's alone
 * (`context.withdrawingVolunteerInvitations`, when the volunteer leaves the pool). Accepting puts the
 * volunteer on the event in the same transaction — an approved registration with the "volunteer"
 * role, which uses up no participant's spot — so an accepted row always has its registration.
 */
const applyDecision: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (operation !== 'update' || !data || !originalDoc || data.status === undefined) return data
  if (data.status === originalDoc.status) return data
  if (originalDoc.status !== 'pending') throw new APIError('O tom už bylo rozhodnuto.', 409)

  const { user } = req
  const application = originalDoc.kind === 'application'
  const byVolunteer = !!user && relationId(originalDoc.volunteer) === String(user.id)
  const trusted = !user || user.role === 'admin' || Boolean(req.context?.withdrawingVolunteerInvitations)

  const eventId = relationId(originalDoc.event)!
  const event = await req.payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
    .catch(() => null)

  if (!trusted) {
    if (data.status === 'withdrawn') {
      if (!(application && byVolunteer)) throw new APIError('Pozvánku můžete jen přijmout, nebo odmítnout.', 400)
    } else if (application) {
      if (byVolunteer) throw new APIError('Svou nabídku pomoci můžete jen stáhnout.', 400)
      if (!event || !isEventCreator(user, event)) {
        throw new APIError('O nabídce dobrovolníka rozhoduje ten, kdo akci založil.', 403)
      }
    }
  }

  data.decidedAt = new Date().toISOString()
  if (data.status !== 'accepted') return data

  const volunteerId = Number(relationId(originalDoc.volunteer))
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError(
      application ? 'Akce už byla zrušena — nabídku můžete jen odmítnout.' : 'Akce už byla zrušena — pozvánku můžete jen odmítnout.',
      409,
    )
  }
  if (new Date(event.dateTime).getTime() <= Date.now()) {
    throw new APIError(application ? 'Akce už začala — nabídku už přijmout nejde.' : 'Akce už začala — pozvánku už přijmout nejde.', 409)
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

/** "★ 4,5 (3×)" — the volunteer's average from organizers, what the creator weighs an offer by. */
async function ratingSummary(req: PayloadRequest, volunteerId: string): Promise<string> {
  const ratings = await req.payload.find({
    collection: 'volunteer-ratings',
    where: { and: [{ volunteer: { equals: volunteerId } }, notDeleted] },
    select: { rating: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (ratings.docs.length === 0) return 'zatím bez hodnocení'
  const average = ratings.docs.reduce((sum, r) => sum + r.rating, 0) / ratings.docs.length
  return `hodnocení ${average.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} z 5 (${ratings.docs.length}×)`
}

const notifyOnInvitationChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
  const { payload } = req
  const eventId = relationId(doc.event)!
  const volunteerId = relationId(doc.volunteer)!
  const inviterId = relationId(doc.invitedBy)!
  const title = escapeHtml(doc.eventTitle)
  const application = doc.kind === 'application'

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
    if (application) {
      // The creator decides — the rest of the team hears once they have.
      const volunteer = await nameOf(volunteerId, 'Dobrovolník')
      const rating = await ratingSummary(req, volunteerId)
      const note = doc.message ? ` Vzkaz: „${doc.message}“` : ''
      sendNotification(payload, {
        userId: inviterId,
        title: 'Dobrovolník nabízí pomoc',
        link: `/spravovat/${eventId}`,
        message: `${volunteer} (${rating}) se nabízí jako dobrovolník na akci „${doc.eventTitle}“.${note}`,
        email: {
          subject: `Dobrovolník nabízí pomoc: ${doc.eventTitle}`,
          body:
            `<p>${escapeHtml(volunteer)} (${escapeHtml(rating)}) se nabízí jako dobrovolník na akci <strong>${title}</strong>.</p>` +
            (doc.message ? `<p>„${escapeHtml(doc.message)}“</p>` : '') +
            `<p>Nabídku přijmete nebo odmítnete ve správě akce.</p>`,
        },
      })
      return doc
    }

    const inviter = await nameOf(inviterId, 'Pořadatel')
    const note = doc.message ? ` Vzkaz: „${doc.message}“` : ''
    sendNotification(payload, {
      userId: volunteerId,
      title: 'Pozvánka k dobrovolnické pomoci',
      link: `/akce/${eventId}`,
      message: `${inviter} vás zve, abyste pomohli na akci „${doc.eventTitle}“.${note}`,
      email: {
        subject: `Pozvánka k dobrovolnické pomoci: ${doc.eventTitle}`,
        body:
          `<p>${escapeHtml(inviter)} vás zve, abyste pomohli na akci <strong>${title}</strong>.</p>` +
          (doc.message ? `<p>„${escapeHtml(doc.message)}“</p>` : '') +
          `<p>Pozvánku přijmete nebo odmítnete na stránce akce nebo v profilu, v sekci Pool dobrovolníků.</p>`,
      },
    })
    return doc
  }

  if (operation !== 'update' || doc.status === previousDoc?.status) return doc
  // Leaving the pool is announced by Profiles itself.
  if (context?.withdrawingVolunteerInvitations) return doc

  const volunteer = await nameOf(volunteerId, 'Dobrovolník')
  const accepted = doc.status === 'accepted'
  const event = await payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
    .catch(() => null)

  if (application) {
    if (doc.status === 'withdrawn') {
      sendNotification(payload, {
        userId: inviterId,
        title: 'Dobrovolník stáhl nabídku',
        link: `/spravovat/${eventId}`,
        message: `${volunteer} už na akci „${doc.eventTitle}“ pomoc nenabízí.`,
      })
      return doc
    }
    sendNotification(payload, {
      userId: volunteerId,
      title: accepted ? 'Pořadatel přijal vaši pomoc' : 'Pořadatel vaši pomoc nepřijal',
      link: `/akce/${eventId}`,
      message: accepted
        ? `Na akci „${doc.eventTitle}“ s vámi počítají jako s dobrovolníkem.`
        : `Na akci „${doc.eventTitle}“ pořadatel tentokrát dobrovolníka nepotřebuje.`,
      email: {
        subject: accepted ? `Pomáháte na akci: ${doc.eventTitle}` : `Nabídka pomoci: ${doc.eventTitle}`,
        body: accepted
          ? `<p>Pořadatel přijal vaši nabídku — na akci <strong>${title}</strong> s vámi počítají jako s dobrovolníkem.</p>`
          : `<p>Na akci <strong>${title}</strong> pořadatel tentokrát dobrovolníka nepotřebuje. Děkujeme za nabídku.</p>`,
      },
    })
    if (accepted && event) {
      const team = await getEventTeamUserIds(payload, event, { exclude: [volunteerId, req.user?.id], req })
      sendNotificationToMany(payload, team, {
        title: 'Nový dobrovolník na akci',
        link: `/spravovat/${eventId}`,
        message: `${volunteer} pomůže na akci „${doc.eventTitle}“.`,
      })
    }
  } else {
    if (doc.status === 'withdrawn') return doc
    // Whoever invited them and everyone running the event.
    const team = event ? await getEventTeamUserIds(payload, event, { exclude: [volunteerId], req }) : []
    sendNotificationToMany(payload, [...new Set([inviterId, ...team])], {
      title: accepted ? 'Dobrovolník přijal pozvánku' : 'Dobrovolník pozvánku odmítl',
      link: accepted ? `/spravovat/${eventId}` : `/akce/${eventId}`,
      message: accepted
        ? `${volunteer} pomůže na akci „${doc.eventTitle}“.`
        : `${volunteer} na akci „${doc.eventTitle}“ pomáhat nebude.`,
    })
  }

  if (accepted && doc.registration && event) {
    try {
      await scheduleParticipantReminder(payload, relationId(doc.registration)!, volunteerId, event)
    } catch (error) {
      payload.logger.error(`Failed to schedule reminder for volunteer invitation ${doc.id}: ${error}`)
    }
  }
  return doc
}

const fixedAfterCreate = { update: () => false }

/**
 * A volunteer helping run one event (brief §7 "Pool dobrovolníků") — agreed from either side. The
 * pool itself only says "you may reach out to me"; this is the commitment for one event:
 * - an invitation: the event's creator asks someone from the pool, who accepts or declines;
 * - an application: someone from the pool offers to help on an event flagged as volunteering, and
 *   the creator accepts or declines (by their ratings, say).
 * Accepting makes them a volunteer on the event (Registrations.role). Leaving the pool withdraws
 * what's still pending and tells the organizers of the events they help on (Profiles).
 */
export const VolunteerInvitations: CollectionConfig = {
  slug: 'volunteer-invitations',
  labels: {
    singular: 'Volunteer Invitation',
    plural: 'Volunteer Invitations',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['eventTitle', 'kind', 'volunteer', 'invitedBy', 'status', 'updatedAt'],
  },
  access: {
    read: canReadInvitation,
    create: ({ req: { user } }) => Boolean(user),
    update: canDecideInvitation,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'invitation',
      access: fixedAfterCreate,
      options: [
        { label: 'Invitation (organizer asks)', value: 'invitation' },
        { label: 'Application (volunteer offers)', value: 'application' },
      ],
      admin: {
        description:
          'Who asked: the event creator inviting a volunteer, or a volunteer offering to help — the other side answers.',
      },
    },
    { name: 'event', type: 'relationship', relationTo: 'events', required: true, access: fixedAfterCreate },
    { name: 'eventTitle', type: 'text', required: true, access: fixedAfterCreate },
    { name: 'volunteer', type: 'relationship', relationTo: 'users', required: true, access: fixedAfterCreate },
    {
      name: 'invitedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: fixedAfterCreate,
      admin: { description: "The organizer's side — who invited, or for an application the event creator who answers it." },
    },
    {
      name: 'message',
      type: 'textarea',
      maxLength: MESSAGE_MAX_LENGTH,
      access: fixedAfterCreate,
      admin: { description: 'A note — what the organizer needs help with, or what the volunteer offers.' },
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
