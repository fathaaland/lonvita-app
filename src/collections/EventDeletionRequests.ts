import type {
  Access,
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'
import { deletionNeedsConsent, eventOrganizerIds, lockedEventIds, administeredIdsFor } from './Events'
import { escapeHtml, sendNotification } from './shared/notify'
import { canCancelEvent, eventCancellationDeadline, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'
import { formatPragueDateTime } from '@/lib/date'

/** How long the other organizers have to answer before the request lapses (the event stays). */
export const DELETION_CONSENT_HOURS = 24

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** The requester, whoever has to consent, the obec's admins and a platform admin. */
const canReadDeletionRequest: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const or: Where[] = [{ requestedBy: { equals: user.id } }, { approvers: { in: [user.id] } }]
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length > 0) or.push({ municipality: { in: administeredIds } })
  const where: Where = { or }
  return where
}

/**
 * Everything about a new request is derived here from the event and the signed-in user — the
 * client only names the event. Only an organizer who runs it together with someone else may ask
 * (a sole organizer or the obec admin simply cancels it); everyone else on it has to consent.
 */
const prepareRequest: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data
  const { user, payload } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const eventId = relationId(data.event)
  const event = eventId
    ? await payload
        .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  if (!event || event.deletedAt) throw new APIError('Akce neexistuje nebo už byla zrušena.', 404)

  const organizerIds = eventOrganizerIds(event)
  if (!organizerIds.includes(String(user.id))) {
    throw new APIError('O smazání akce může požádat jen její pořadatel nebo spolupořadatel.', 403)
  }
  const locked = await lockedEventIds(req, user.id, [event], await administeredIdsFor(req, user.id))
  if (locked.has(String(event.id))) {
    throw new APIError('Tuhle akci pořádá obec — smazat ji může jen admin obce.', 403)
  }
  if (!(await deletionNeedsConsent(req, user, event))) {
    throw new APIError('Tuhle akci můžete zrušit rovnou, souhlas nikoho dalšího nepotřebuje.', 400)
  }
  if (!canCancelEvent(event.dateTime)) {
    throw new APIError(`Akci lze smazat nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.`, 400)
  }

  const open = await payload.find({
    collection: 'event-deletion-requests',
    where: {
      and: [
        { event: { equals: event.id } },
        { status: { equals: 'pending' } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (open.docs.length > 0) throw new APIError('O smazání téhle akce už se rozhoduje.', 400)

  // Never past the cancellation cut-off — a consent arriving after it couldn't delete anything.
  const expiresAt = Math.min(
    Date.now() + DELETION_CONSENT_HOURS * 60 * 60 * 1000,
    eventCancellationDeadline(event.dateTime).getTime(),
  )

  return {
    event: event.id,
    eventTitle: event.title,
    municipality: relationId(event.municipality) ? Number(relationId(event.municipality)) : null,
    requestedBy: user.id,
    approvers: organizerIds.filter((id) => id !== String(user.id)).map(Number),
    approvedBy: [],
    status: 'pending',
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

const notifyApprovers: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc

  const requesterId = relationId(doc.requestedBy)!
  const profile = await req.payload.find({
    collection: 'profiles',
    where: { user: { equals: requesterId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  const who = profile.docs[0]?.fullName || 'Spolupořadatel'
  const until = formatPragueDateTime(doc.expiresAt)
  const eventId = relationId(doc.event)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  for (const approverId of (doc.approvers ?? []).map(relationId)) {
    sendNotification(req.payload, {
      userId: approverId!,
      title: 'Žádost o smazání akce',
      link: `/akce/${eventId}`,
      message: `${who} chce smazat akci „${doc.eventTitle}“, kterou spolu pořádáte. Bez vašeho souhlasu se nesmaže — odpovězte do ${until}.`,
      email: {
        subject: `Žádost o smazání akce: ${doc.eventTitle}`,
        body:
          `<p><strong>${escapeHtml(who)}</strong> chce smazat akci <strong>${escapeHtml(doc.eventTitle)}</strong>, kterou spolu pořádáte.</p>` +
          `<p>Bez vašeho souhlasu se akce nesmaže. Odpovědět můžete do ${until} — když neodpovíte, akce zůstane.</p>` +
          `<p><a href="${appUrl}/akce/${eventId}">Otevřít akci a rozhodnout</a></p>`,
      },
    })
  }
  return doc
}

/** A pending request past its 24 h reads back as "expired" — no cron needed, like Events'
 * deriveFinishedStatus; best-effort persisted so listings converge. The event is left as it was. */
const deriveExpiredStatus: CollectionAfterReadHook = ({ doc, req }) => {
  if (doc.status !== 'pending' || new Date(doc.expiresAt).getTime() > Date.now()) return doc
  req.payload
    .update({
      collection: 'event-deletion-requests',
      id: doc.id,
      data: { status: 'expired' },
      overrideAccess: true,
    })
    .catch((error) => req.payload.logger.error(`Failed to persist expired deletion request ${doc.id}: ${error}`))
  return { ...doc, status: 'expired' }
}

/**
 * Two organizers running an event together must both agree before it's deleted: one asks, the
 * others get notified and have DELETION_CONSENT_HOURS to confirm. All confirm → the event is
 * hard-deleted (api/events/deletion-requests/[id]/decide); anyone refuses, or time runs out → the
 * event stays. Created over REST; decided only through that route (update is closed here).
 */
export const EventDeletionRequests: CollectionConfig = {
  slug: 'event-deletion-requests',
  labels: {
    singular: 'Event Deletion Request',
    plural: 'Event Deletion Requests',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['eventTitle', 'requestedBy', 'status', 'expiresAt'],
  },
  access: {
    read: canReadDeletionRequest,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      // Not `required`: once approved the event is hard-deleted and this goes null (the row stays
      // as history, with eventTitle below).
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
    },
    {
      name: 'eventTitle',
      type: 'text',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
    },
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'approvers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      admin: { description: 'Everyone else organizing the event — all of them have to consent.' },
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved (event deleted)', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Expired', value: 'expired' },
      ],
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
    },
    {
      name: 'decidedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
    },
    {
      name: 'decidedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
  ],
  hooks: {
    beforeValidate: [prepareRequest],
    afterChange: [notifyApprovers],
    afterRead: [deriveExpiredStatus],
  },
  timestamps: true,
}
