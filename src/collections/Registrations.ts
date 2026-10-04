import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionBeforeOperationHook,
  CollectionConfig,
  FieldAccess,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { publishCapacityChange } from '@/lib/realtime/eventCapacity'
import { isRegistrationOpen, REGISTRATION_CUTOFF_HOURS } from '@/lib/registrationCutoff'
import { describeUser, escapeHtml, getEventTeamUserIds, sendNotification, sendNotificationToMany } from './shared/notify'
import { cancelParticipantReminder, scheduleFeedbackRequest, scheduleParticipantReminder } from './shared/reminders'

import { getAdministeredMunicipalityIds, isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'
import { deletedAtField, notDeleted } from './shared/softDelete'

/** Who takes up the event's places: participants. A volunteer helping run it (an accepted
 * VolunteerInvitation) never uses up a participant's spot. */
export const PARTICIPANTS_ONLY: Where = { role: { not_equals: 'volunteer' } }

const REGISTRATION_STATUS_SUBJECT: Record<string, string> = {
  approved: 'Vaše přihláška byla schválena',
  rejected: 'Vaše přihláška byla zamítnuta',
}

/** Brief §8 live "Přihlásit se"/"Akce je plná" button — publish the event's new approved
 * count whenever a change could have added or removed someone from that count (a fresh
 * approval, or an existing approved registration being cancelled/rejected). Any other status
 * transition (pending -> rejected, cancelled -> pending, etc.) never touched the approved
 * count, so skip the publish rather than send a no-op update to every open detail page.
 *
 * US-P-08: the same count also drives the event's own `status` — flipped to 'full' once
 * approved registrations reach capacity, and back to 'active' once they drop below it again.
 * Never overwrites 'cancelled' or 'finished', which are terminal/time-driven, not capacity-driven. */
const broadcastCapacityChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  // Only approved participants use up places — a volunteer turning participant (leaving the pool)
  // or the other way round (an accepted invitation) moves the count just like an approval does.
  const counts = (reg: { status?: string | null; role?: string | null } | undefined) =>
    reg?.status === 'approved' && reg?.role !== 'volunteer'
  // On create there's no previousDoc, so only a create that lands straight in "approved"
  // (organizer-registers-own-event, or auto-approval mode) can have changed the count.
  const mayHaveChanged = operation === 'create' ? counts(doc) : counts(previousDoc) !== counts(doc)
  if (!mayHaveChanged) return doc

  const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event
  try {
    // Passing `req` matters: this write is still inside the current request's DB
    // transaction, so a count query on a fresh connection (no `req`) would run against the
    // pre-write snapshot and undercount the row that was just approved/unapproved.
    const result = await req.payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: eventId } }, { status: { equals: 'approved' } }, PARTICIPANTS_ONLY] },
      overrideAccess: true,
      req,
    })
    publishCapacityChange(eventId, result.totalDocs)

    const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    if (event.status === 'active' || event.status === 'full') {
      const shouldBeFull = result.totalDocs >= event.capacity
      const nextStatus = shouldBeFull ? 'full' : 'active'
      if (nextStatus !== event.status) {
        await req.payload.update({
          collection: 'events',
          id: eventId,
          data: { status: nextStatus },
          overrideAccess: true,
          req,
        })
      }
    }
  } catch (error) {
    req.payload.logger.error(`Failed to broadcast capacity change for event ${eventId}: ${error}`)
  }
  return doc
}

const notifyOnRegistrationChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  // Seeded demo registrations (src/lib/seed/run.ts) mustn't mail anyone or queue reminders; a
  // volunteer's comes from an accepted invitation, which tells everyone itself (VolunteerInvitations).
  // Nor one cancelled because its holder now runs the event (Events releaseOrganizersPlaces).
  if (
    context?.skipNotifications ||
    context?.volunteerInvitation ||
    context?.leavingVolunteerPool ||
    context?.joiningAsOrganizer
  ) {
    return doc
  }
  try {
    const userId = typeof doc.user === 'object' ? doc.user.id : doc.user
    const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event
    const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    const organizerId = typeof event.organizer === 'object' ? event.organizer.id : event.organizer

    // Brief §7 "Přihlášení na akci → účastník" — confirmation on create, whatever status it
    // landed in (auto-approved, or pending an organizer's review).
    if (operation === 'create') {
      const isSelfOrganizing = String(organizerId) === String(userId)
      if (!isSelfOrganizing) {
        const pending = doc.status === 'pending'
        await sendNotification(req.payload, {
          userId,
          title: pending ? 'Přihláška odeslána' : 'Přihláška potvrzena',
          message: pending
            ? `Vaše přihláška na akci „${event.title}“ čeká na schválení organizátorem.`
            : `Jste přihlášeni na akci „${event.title}“.`,
          link: `/akce/${eventId}`,
          email: {
            subject: pending ? `Přihláška odeslána: ${event.title}` : `Přihláška potvrzena: ${event.title}`,
            body: pending
              ? `<p>Vaše přihláška na akci <strong>${escapeHtml(event.title)}</strong> čeká na schválení organizátorem.</p>`
              : `<p>Jste přihlášeni na akci <strong>${escapeHtml(event.title)}</strong>.</p>`,
          },
        })

        // Brief §7 "Nové přihlášení na akci → organizátor" — to everyone running it, who all
        // approve registrations (guardStatusChange); the manage page is where they do.
        const who = await describeUser(req.payload, userId)
        const awaiting = pending ? ' Přihláška čeká na vaše schválení.' : ''
        await sendNotificationToMany(req.payload, await getEventTeamUserIds(req.payload, event, { exclude: [userId] }), {
          title: 'Nová přihláška na akci',
          message: `${who} se přihlásil(a) na vaši akci „${event.title}“.${awaiting}`,
          link: `/spravovat/${eventId}`,
          email: {
            subject: `Nová přihláška: ${event.title}`,
            body: `<p>${escapeHtml(who)} se přihlásil(a) na vaši akci <strong>${escapeHtml(event.title)}</strong>.${awaiting}</p>`,
          },
        })
      }
      return doc
    }

    if (operation !== 'update' || doc.status === previousDoc?.status) return doc

    // Task 9: a cancelled registration tells everyone running the event (pořadatel,
    // spolupořadatelé, the obec when it takes part) who it was — name and e-mail, so they can
    // reach them. Whoever cancelled it isn't told about their own doing. An excuse
    // (guardOwnCancellation) carries the participant's own words.
    if (doc.status === 'cancelled') {
      const recipients = await getEventTeamUserIds(req.payload, event, { exclude: [req.user?.id, userId] })
      if (recipients.length > 0) {
        const volunteer = doc.role === 'volunteer'
        const who = await describeUser(req.payload, userId)
        const excuse = doc.excuseMessage?.trim()
        const base = excuse
          ? volunteer
            ? `Dobrovolník ${who} se omlouvá — na akci „${event.title}“ nepomůže.`
            : `${who} se omlouvá — na akci „${event.title}“ nepřijde.`
          : volunteer
            ? `Dobrovolník ${who} už na akci „${event.title}“ nepomůže — jeho účast byla zrušena.`
            : `${who} už na akci „${event.title}“ nepřijde — přihláška byla zrušena.`
        const message = `${base}${excuse ? ` Omluvenka: „${excuse}“` : ''}`
        await sendNotificationToMany(req.payload, recipients, {
          title: excuse ? 'Omluvenka z akce' : volunteer ? 'Dobrovolník nepřijde' : 'Přihláška zrušena',
          message,
          link: `/spravovat/${eventId}`,
          email: {
            subject: `${excuse ? 'Omluvenka' : 'Zrušená přihláška'}: ${event.title}`,
            body: `<p>${escapeHtml(base)}</p>${excuse ? `<blockquote>${escapeHtml(excuse)}</blockquote>` : ''}`,
          },
        })
      }
      return doc
    }

    // Taken back off the event after being approved — "zamítnuta" would read as if they'd never
    // been let in at all.
    if (doc.status === 'rejected' && previousDoc?.status === 'approved') {
      await sendNotification(req.payload, {
        userId,
        link: `/akce/${eventId}`,
        title: 'Pořadatel vás z akce odhlásil',
        message: `Pořadatel vás odhlásil z akce „${event.title}“ — už s vámi na ní nepočítá.`,
        email: {
          subject: `Odhlášení z akce: ${event.title}`,
          body: `<p>Pořadatel vás odhlásil z akce <strong>${escapeHtml(event.title)}</strong> — už s vámi na ní nepočítá.</p>`,
        },
      })
      return doc
    }

    if (!REGISTRATION_STATUS_SUBJECT[doc.status]) return doc

    const approved = doc.status === 'approved'
    await sendNotification(req.payload, {
      userId,
      link: `/akce/${eventId}`,
      title: REGISTRATION_STATUS_SUBJECT[doc.status],
      message: approved
        ? `Vaše přihláška na akci „${event.title}“ byla schválena.`
        : `Vaše přihláška na akci „${event.title}“ byla bohužel zamítnuta.`,
      email: {
        subject: `${REGISTRATION_STATUS_SUBJECT[doc.status]}: ${event.title}`,
        body: approved
          ? `<p>Vaše přihláška na akci <strong>${escapeHtml(event.title)}</strong> byla schválena.</p>`
          : `<p>Vaše přihláška na akci <strong>${escapeHtml(event.title)}</strong> byla bohužel zamítnuta.</p>`,
      },
    })

    // 24h reminder — scheduled at approval time (brief §A5: "levné a užitečné"), and moved
    // along with the event if it's rescheduled later (see shared/reminders.ts).
    if (approved) {
      await scheduleParticipantReminder(req.payload, doc.id, userId, event)
    }
  } catch (error) {
    req.payload.logger.error(`Failed to notify on registration change: ${error}`)
  }

  return doc
}

/** Approved, then no longer coming (taken off the event, or cancelled themselves) — the 24h
 * reminder scheduled at approval goes too, or they'd still be told to come. */
const dropReminderWhenNoLongerComing: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || previousDoc?.status !== 'approved' || doc.status === 'approved') return doc
  try {
    await cancelParticipantReminder(doc.id)
  } catch (error) {
    req.payload.logger.error(`Failed to drop the reminder for registration ${doc.id}: ${error}`)
  }
  return doc
}

/** US-U-03 — once the organizer marks someone as attended, they're asked to rate the event
 * (delayed until after it ends; see scheduleFeedbackRequest). Only on the transition into
 * "attended", so re-saving an already-marked row doesn't queue anything new. */
const scheduleFeedbackOnAttendance: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
  if (context?.skipNotifications) return doc
  if (operation !== 'update' || doc.attendanceStatus !== 'attended' || previousDoc?.attendanceStatus === 'attended') {
    return doc
  }
  const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event
  try {
    const event = await req.payload.findByID({
      collection: 'events',
      id: eventId,
      depth: 0,
      overrideAccess: true,
    })
    await scheduleFeedbackRequest(doc.id, event)
  } catch (error) {
    req.payload.logger.error(`Failed to schedule feedback request for registration ${doc.id}: ${error}`)
  }
  return doc
}

/** Attendance is the pořadatel's record of who actually came — it gates who may rate the event
 * (EventFeedback), whom the pořadatel may rate as a volunteer, and feeds the obec's analytics. Only
 * the event's own pořadatel (who founded it) fills it in — not its spolupořadatelé, not the obec when
 * it co-organizes — so there's one person answerable for it. Collection-level update access also lets
 * a participant update their own registration (to cancel it), so without this they could PATCH
 * themselves to "attended". Looked up once per request, not once per attendance field. */
const canMarkAttendance: FieldAccess = async ({ req, doc }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  if (!doc?.event) return false
  const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event
  const cacheKey = `canMarkAttendance:${eventId}`
  if (typeof req.context[cacheKey] === 'boolean') return req.context[cacheKey]

  const event = await req.payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  const organizerId = event ? (typeof event.organizer === 'object' ? event.organizer.id : event.organizer) : null
  const allowed = organizerId !== null && String(organizerId) === String(req.user.id)
  req.context[cacheKey] = allowed
  return allowed
}

const relId = (value: unknown) => (value && typeof value === 'object' ? (value as { id: number }).id : (value as number))

/**
 * Attendance is written once and stays — the pořadatel confirms it before saving, and the feedback
 * prompt and the volunteer rating hang off it. Field access (canMarkAttendance) is what actually
 * keeps anyone else out, but Payload drops such a field silently; this runs first (beforeOperation
 * precedes every field pass) purely to answer with a real error instead of a 200 that changed
 * nothing. Only when access control applies (every REST request); a platform admin may still correct.
 */
const lockAttendanceOnceMarked: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update') return args
  const { data, id, overrideAccess } = args as {
    data?: { attendanceStatus?: unknown }
    id?: number | string
    overrideAccess?: boolean
  }
  // No id = a bulk update by `where`; field access still strips the field there.
  if (overrideAccess !== false || data?.attendanceStatus === undefined || id === undefined) return args
  if (!req.user || req.user.role === 'admin') return args

  const current = await req.payload.findByID({ collection: 'registrations', id, depth: 0, overrideAccess: true, req })
  if (current.attendanceStatus === data.attendanceStatus) return args
  const event = await req.payload
    .findByID({ collection: 'events', id: relId(current.event), depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (!event || String(relId(event.organizer)) !== String(req.user.id)) {
    throw new APIError('Docházku zapisuje jen pořadatel, který akci založil.', 403)
  }
  if (current.attendanceStatus && current.attendanceStatus !== 'not_marked') {
    throw new APIError('Docházka je už potvrzená — změnit ji nejde.', 409)
  }
  return args
}

/**
 * Who may move a registration where. The registrant may only cancel their own — collection-level
 * update access lets them touch it for that, so without this they could PATCH themselves "approved"
 * past the organizer. Approving, rejecting and taking an approved participant back off the event is
 * for whoever runs it: the pořadatel, every spolupořadatel and the obec's admins — though not once
 * their attendance is confirmed, the record of what actually happened. A volunteer is the creator's
 * alone (like inviting them, VolunteerInvitations): nobody else takes one off. Nobody decides about
 * their own registration, though: an obec's admin signed up for a club's event in their obec is
 * there as themselves, a participant like any other. Like lockAttendanceOnceMarked,
 * only when access control applies (every REST request); a platform admin may always.
 */
const guardStatusChange: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update') return args
  const { data, id, overrideAccess } = args as {
    data?: { status?: unknown }
    id?: number | string
    overrideAccess?: boolean
  }
  if (overrideAccess !== false || data?.status === undefined || id === undefined) return args
  if (!req.user || req.user.role === 'admin') return args

  const current = await req.payload.findByID({ collection: 'registrations', id, depth: 0, overrideAccess: true, req })
  if (current.status === data.status) return args

  const event = await req.payload
    .findByID({ collection: 'events', id: relId(current.event), depth: 0, overrideAccess: true, req })
    .catch(() => null)
  const volunteer = current.role === 'volunteer'
  const own = String(relId(current.user)) === String(req.user.id)
  const organizerIds = event ? [event.organizer, ...(event.coOrganizers ?? [])].map((u) => String(relId(u))) : []
  // The event's volunteers are its creator's alone — not a spolupořadatel's, not the obec's.
  const manages =
    event !== null &&
    !own &&
    (volunteer
      ? String(relId(event.organizer)) === String(req.user.id)
      : organizerIds.includes(String(req.user.id)) ||
        (await getAdministeredMunicipalityIds(req.payload, req.user.id)).includes(String(relId(event.municipality))))

  if (!manages) {
    if (data.status !== 'cancelled' || !own) {
      throw new APIError(
        volunteer
          ? 'O dobrovolnících na akci rozhoduje jen pořadatel, který ji založil.'
          : own
            ? 'O vlastní přihlášce nerozhodujete — schvaluje ji pořadatel akce, vy ji můžete jen zrušit.'
            : 'Přihlášky schvaluje a zamítá jen pořadatel akce.',
        403,
      )
    }
    return args
  }
  if (current.status === 'approved' && current.attendanceStatus && current.attendanceStatus !== 'not_marked') {
    throw new APIError('Docházka je už potvrzená — z akce ho odebrat nejde.', 409)
  }
  return args
}

/**
 * Cancelling one's own registration — optionally with an excuse to the organizer — closes
 * REGISTRATION_CUTOFF_HOURS before the start, just like signing up (guardRegistrationWindow): after that
 * the organizer may no longer be watching the app, so whoever can't come calls or e-mails them. The
 * excuse only ever rides along the registrant's own cancellation. Like guardStatusChange, only when
 * access control applies; internal cancellations (leaving the volunteer pool, organizers joining the
 * team) and the event's organizers taking someone off pass.
 */
const guardOwnCancellation: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update') return args
  const { data, id, overrideAccess } = args as {
    data?: { status?: unknown; excuseMessage?: unknown }
    id?: number | string
    overrideAccess?: boolean
  }
  if (overrideAccess !== false || id === undefined || !req.user) return args
  const excuse = typeof data?.excuseMessage === 'string' ? data.excuseMessage.trim() : ''
  if (data?.status !== 'cancelled' && !excuse) return args

  const current = await req.payload.findByID({ collection: 'registrations', id, depth: 0, overrideAccess: true, req })
  const cancelling = data?.status === 'cancelled' && current.status !== 'cancelled'
  const own = String(relId(current.user)) === String(req.user.id)
  if (excuse && (!cancelling || !own)) {
    throw new APIError('Omluvenku posílá jen přihlášený sám, spolu se zrušením své přihlášky.', 400)
  }
  if (!cancelling || !own) return args

  const event = await req.payload
    .findByID({ collection: 'events', id: relId(current.event), depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (event && !isRegistrationOpen(event.dateTime) && req.user.role !== 'admin') {
    throw new APIError(
      `Odhlásit se z akce lze nejpozději ${REGISTRATION_CUTOFF_HOURS} hodiny před jejím začátkem — zavolejte nebo napište pořadateli.`,
      400,
    )
  }
  return args
}

/**
 * Signing up closes REGISTRATION_CUTOFF_HOURS before the start — whoever still wants to come calls or
 * e-mails the organizer, who may have stopped watching the app by then. Like guardStatusChange, only
 * when access control applies (every REST request); a volunteer joining through an accepted
 * invitation, arranged with the organizer, passes.
 */
const guardRegistrationWindow: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'create') return args
  const { data, overrideAccess } = args as { data?: { event?: unknown }; overrideAccess?: boolean }
  if (overrideAccess !== false || !data?.event || !req.user || req.user.role === 'admin') return args

  const event = await req.payload
    .findByID({ collection: 'events', id: relId(data.event), depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (event && !isRegistrationOpen(event.dateTime)) {
    throw new APIError(
      `Přihlásit se na akci lze nejpozději ${REGISTRATION_CUTOFF_HOURS} hodiny před jejím začátkem — zavolejte nebo napište pořadateli.`,
      400,
    )
  }
  return args
}

/**
 * When a registration was cancelled — set here, never taken from the client. The excuse is written
 * once, with the cancellation, and stays as it was.
 */
const stampCancellation: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update' || !data || !originalDoc) return data
  if (data.status !== 'cancelled' || originalDoc.status === 'cancelled') {
    data.excuseMessage = originalDoc.excuseMessage ?? null
    return data
  }

  data.cancelledAt = new Date().toISOString()
  data.excuseMessage = typeof data.excuseMessage === 'string' ? data.excuseMessage.trim() || null : null
  return data
}

/** The obec's admins may hard-delete registrations in their obec — but not a volunteer's, which is
 * the event creator's alone (guardStatusChange). Like guardStatusChange, only when access control
 * applies — trusted internal deletes (a consented event deletion, an account deletion) pass. */
const guardVolunteerDelete: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'delete') return args
  const { id, where, overrideAccess } = args as { id?: number | string; where?: Where; overrideAccess?: boolean }
  if (overrideAccess !== false || !req.user || req.user.role === 'admin') return args

  const volunteers = await req.payload.find({
    collection: 'registrations',
    where: { and: [id !== undefined ? { id: { equals: id } } : (where ?? {}), { role: { equals: 'volunteer' } }] },
    select: { event: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const eventIds = [...new Set(volunteers.docs.map((r) => relId(r.event)))]
  if (eventIds.length === 0) return args
  const events = await req.payload.find({
    collection: 'events',
    where: { id: { in: eventIds } },
    select: { organizer: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (events.docs.length === eventIds.length && events.docs.every((e) => String(relId(e.organizer)) === String(req.user!.id))) {
    return args
  }
  throw new APIError('O dobrovolnících na akci rozhoduje jen pořadatel, který ji založil.', 403)
}

/** Who marked attendance and when — set here, never taken from the client. */
const stampAttendance: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !data || data.attendanceStatus === undefined || !req.user) return data
  if (data.attendanceStatus === originalDoc?.attendanceStatus) return data
  data.attendanceMarkedBy = req.user.id
  data.attendanceMarkedAt = new Date().toISOString()
  return data
}

/** Nobody registers someone as already attended — only a platform admin may set these on create. */
const isPlatformAdminField: FieldAccess = ({ req }) => req.user?.role === 'admin'

const attendanceAccess = { create: isPlatformAdminField, update: canMarkAttendance }

const isOwnRegistrationField: FieldAccess = ({ req, doc }) =>
  Boolean(req.user && doc?.user && String(relId(doc.user)) === String(req.user.id))

/** Registrations a user may act on: their own (to register/cancel), or any belonging to an
 * event they organize/co-organize or whose municipality they administer (to approve/reject
 * and mark attendance). Shared by read and update access — resolved to plain event ids up
 * front instead of `event.organizer` / `event.coOrganizers` paths inside the access query,
 * since OR-ing several relationship joins there matched every row. */
const ownOrManagedRegistrationsWhere = async (req: Parameters<Access>[0]['req']): Promise<Where> => {
  const { user, payload } = req
  const administeredIds = await getAdministeredMunicipalityIds(payload, user!.id)
  const manageableEventsWhere: Where[] = [{ organizer: { equals: user!.id } }, { coOrganizers: { in: [user!.id] } }]
  if (administeredIds.length > 0) manageableEventsWhere.push({ municipality: { in: administeredIds } })
  const manageableEvents = await payload.find({
    collection: 'events',
    where: { or: manageableEventsWhere },
    select: { organizer: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })

  const or: Where[] = [{ user: { equals: user!.id } }]
  if (manageableEvents.docs.length > 0) or.push({ event: { in: manageableEvents.docs.map((e) => e.id) } })
  return { or }
}

/** "Kdo dále jde" is only for the event's organizer and the obec's admin — a registration is
 * readable by the registrant themself, the event's organizer/co-organizers, an admin of the event's
 * municipality and a platform admin. Everyone else gets participant counts only, via the public
 * /api/events/registration-counts route. */
const canReadRegistration: Access = async ({ req }) => {
  if (!req.user) return false
  const visible: Where = { deletedAt: { exists: false } }
  if (req.user.role === 'admin') return visible
  return { and: [visible, await ownOrManagedRegistrationsWhere(req)] }
}

/** Approving/rejecting/marking attendance is limited the same way as reading (event's
 * organizer/co-organizers, the municipality's admin, or a platform admin); a participant may
 * additionally update their own registration to cancel it. Without this, `isLoggedIn` alone let
 * any logged-in user PATCH any registration in the system, including other people's. */
const canUpdateRegistration: Access = async ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  return ownOrManagedRegistrationsWhere(req)
}

export const Registrations: CollectionConfig = {
  slug: 'registrations',
  labels: {
    singular: 'Registration',
    plural: 'Registrations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['event', 'user', 'status', 'attendanceStatus', 'updatedAt'],
  },
  access: {
    read: canReadRegistration,
    create: isLoggedIn,
    update: canUpdateRegistration,
    // Platform superadmin everywhere, or a municipality admin scoped to their own
    // municipality (traverses the relationship: registration -> event -> municipality).
    delete: isPlatformOrMunicipalityAdmin('event.municipality'),
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        description: '"Smí přijít" — whether the registration itself is allowed, not whether they attended.',
      },
    },
    {
      name: 'role',
      type: 'select',
      defaultValue: 'participant',
      // Only an accepted VolunteerInvitation makes someone a volunteer (overrideAccess) — nobody
      // signs up as one, or turns their own participant registration into one.
      access: { create: isPlatformAdminField, update: isPlatformAdminField },
      options: [
        { label: 'Participant', value: 'participant' },
        { label: 'Volunteer', value: 'volunteer' },
      ],
      admin: {
        description:
          'A volunteer helps run the event (an accepted VolunteerInvitation) — approved straight away, and not counted against capacity.',
      },
    },
    {
      name: 'excuseMessage',
      type: 'textarea',
      maxLength: 1000,
      // The registrant's own words, sent along with cancelling their registration (guardOwnCancellation).
      access: { create: isPlatformAdminField, update: isOwnRegistrationField },
      admin: {
        description: `Omluvenka — sent by the registrant when cancelling, at the latest ${REGISTRATION_CUTOFF_HOURS} hours before the event.`,
      },
    },
    {
      name: 'cancelledAt',
      type: 'date',
      access: { create: isPlatformAdminField, update: isPlatformAdminField },
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'attendanceStatus',
      type: 'select',
      defaultValue: 'not_marked',
      access: attendanceAccess,
      options: [
        { label: 'Not marked', value: 'not_marked' },
        { label: 'Attended', value: 'attended' },
        { label: 'No-show', value: 'no_show' },
        { label: 'Excused', value: 'excused' },
      ],
      admin: {
        description: 'What actually happened — set by the organizer after the event, on the manage-event page.',
      },
    },
    {
      name: 'attendanceMarkedAt',
      type: 'date',
      access: attendanceAccess,
      admin: { position: 'sidebar' },
    },
    {
      name: 'attendanceMarkedBy',
      type: 'relationship',
      access: attendanceAccess,
      relationTo: 'users',
      admin: {
        description: 'The organizer who marked attendance.',
        position: 'sidebar',
      },
    },
    {
      name: 'attendanceNote',
      type: 'text',
      access: attendanceAccess,
      admin: { position: 'sidebar' },
    },
    deletedAtField,
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.event || !data?.user) return data

        if (operation === 'update' && originalDoc?.event === data.event && originalDoc?.user === data.user) {
          return data
        }

        // A cancelled registration doesn't block re-registering — both rows stay in
        // history (cancel + re-register), which matches append-only event tracking (brief §A2)
        // better than the old hard-delete-and-recreate flow did.
        const existing = await req.payload.find({
          collection: 'registrations',
          where: {
            and: [
              { event: { equals: data.event } },
              { user: { equals: data.user } },
              { status: { not_equals: 'cancelled' } },
            ],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error('This user is already registered for this event.')
        }

        if (operation === 'create') {
          const event = await req.payload.findByID({
            collection: 'events',
            id: data.event,
            depth: 0,
            overrideAccess: true,
          })
          const organizerIds = [event.organizer, ...(event.coOrganizers ?? [])].map((u) =>
            String(typeof u === 'object' ? u.id : u),
          )

          // Whoever runs the event takes part in it automatically — the pořadatel, every
          // spolupořadatel and, whenever the obec runs or co-organizes it, each of its admins. A
          // registration would only use up one of the participants' spots. On anyone else's event
          // they sign up like everyone else — as themselves, never for their organization or obec.
          if (organizerIds.includes(String(data.user))) {
            throw new APIError(
              'Tuto akci pořádáte — na vlastní akci se nepřihlašujete, počítá se s vámi automaticky a nezabíráte místo účastníkům.',
              400,
            )
          }
          if ((await getEventTeamUserIds(req.payload, event, { req })).includes(String(data.user))) {
            throw new APIError(
              'Tuto akci pořádá vaše obec — jako její admin se na ni nepřihlašujete, počítá se s vámi automaticky a nezabíráte místo účastníkům.',
              400,
            )
          }
          if (data.role !== 'volunteer' && event.registrationApprovalMode === 'auto') {
            // Brief §4/§8 — "auto" registers everyone immediately, so the capacity check has
            // to happen server-side here, not just as a disabled button on the frontend (that
            // read can be stale). What happens to a signup that arrives once it's already full
            // under "auto" (waitlist vs. hard reject) is still an open question (brief §8) —
            // for now it's a hard reject, the simplest safe behavior.
            const activeCount = await req.payload.count({
              collection: 'registrations',
              where: {
                and: [{ event: { equals: data.event } }, { status: { in: ['pending', 'approved'] } }, PARTICIPANTS_ONLY],
              },
              overrideAccess: true,
            })
            if (activeCount.totalDocs >= event.capacity) {
              throw new Error('This event is already at full capacity.')
            }
            data.status = 'approved'
          }
        }

        return data
      },
    ],
    beforeOperation: [
      guardRegistrationWindow,
      guardStatusChange,
      guardOwnCancellation,
      lockAttendanceOnceMarked,
      guardVolunteerDelete,
    ],
    beforeChange: [stampAttendance, stampCancellation],
    afterChange: [
      notifyOnRegistrationChange,
      broadcastCapacityChange,
      dropReminderWhenNoLongerComing,
      scheduleFeedbackOnAttendance,
    ],
  },
  timestamps: true,
}
