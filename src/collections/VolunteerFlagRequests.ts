import type { CollectionAfterChangeHook, CollectionBeforeValidateHook, CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'

import { canReadOwnOrAdministered, isPlatformOrMunicipalityAdmin } from './access/shared'
import { escapeHtml, getEventTeamUserIds, getMunicipalityAdminUserIds, sendNotification, sendNotificationToMany } from './shared/notify'
import { writeAuditLog } from './shared/auditLog'
import { isEventCreator } from './Events'

const relId = (value: unknown): number | string =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

/**
 * Only the event's creator asks for the flag — not a spolupořadatel, not the obec (Events
 * isEventCreator). Over REST the request is filed under whoever is signed in, never someone the
 * client names; a trusted Local API write without a user names the requester itself. Not for a
 * cancelled event, one that already has the flag, or one with a request still waiting on the obec.
 */
const prepareRequest: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data
  const { user, payload } = req
  const requester = user ?? (data.requestedBy ? { id: relId(data.requestedBy) } : null)
  if (!requester) throw new APIError('Nejste přihlášeni.', 401)
  const eventId = data.event ? relId(data.event) : null
  const event = eventId
    ? await payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req }).catch(() => null)
    : null
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce neexistuje nebo už byla zrušena.', 404)
  }
  if (!isEventCreator(requester, event)) {
    throw new APIError('O příznak Dobrovolnictví může požádat jen ten, kdo akci založil.', 403)
  }
  if (event.isVolunteering) throw new APIError('Akce už příznak Dobrovolnictví má.', 400)
  const pending = await payload.count({
    collection: 'volunteer-flag-requests',
    where: { and: [{ event: { equals: event.id } }, { status: { equals: 'pending' } }] },
    overrideAccess: true,
    req,
  })
  if (pending.totalDocs > 0) throw new APIError('Žádost o příznak Dobrovolnictví už čeká na schválení obcí.', 400)
  return { ...data, event: event.id, requestedBy: requester.id, status: 'pending' }
}

/** The obec's answer goes to whoever asked and to everyone else running the event — the flag is
 * the event's, not the requester's — but not to the admin who decided. */
async function notifyTeamOfDecision(
  req: PayloadRequest,
  doc: { id: number | string },
  requesterId: number | string,
  eventId: number | string,
  approved: boolean,
): Promise<void> {
  try {
    const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    const team = await getEventTeamUserIds(req.payload, event, { exclude: [req.user?.id] })
    const recipients = [...new Set([String(requesterId), ...team])].filter((id) => id !== String(req.user?.id))
    const outcome = approved ? 'schválen' : 'zamítnut'
    sendNotificationToMany(req.payload, recipients, {
      title: `Příznak Dobrovolnictví ${outcome}`,
      link: `/akce/${eventId}`,
      message: `Žádost o příznak Dobrovolnictví pro akci „${event.title}“ byla ${approved ? 'schválena' : 'zamítnuta'}.`,
      email: {
        subject: `Příznak Dobrovolnictví ${outcome}`,
        body: `<p>Žádost o příznak Dobrovolnictví pro akci <strong>${escapeHtml(event.title)}</strong> byla ${approved ? 'schválena' : 'bohužel zamítnuta'}.</p>`,
      },
    })
  } catch (error) {
    req.payload.logger.error(`Failed to notify about volunteer-flag request ${doc.id}: ${error}`)
  }
}

const notifyOnRequestChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const requesterId = typeof doc.requestedBy === 'object' ? doc.requestedBy.id : doc.requestedBy
  const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event

  if (operation === 'create') {
    const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    const municipalityId = typeof event.municipality === 'object' ? event.municipality.id : event.municipality
    const adminIds = await getMunicipalityAdminUserIds(req.payload, municipalityId)
    for (const adminId of adminIds) {
      sendNotification(req.payload, {
        userId: adminId,
        title: 'Nová žádost o příznak Dobrovolnictví',
        link: '/admin-obce?tab=requests',
        message: `Organizátor požádal o příznak Dobrovolnictví pro akci „${event.title}“.`,
        email: {
          subject: 'Nová žádost o příznak Dobrovolnictví',
          body: `<p>Organizátor požádal o příznak Dobrovolnictví pro akci <strong>${escapeHtml(event.title)}</strong> — vyřiďte to v sekci Žádosti v adminu obce.</p>`,
        },
      })
    }
    return
  }

  if (operation === 'update' && doc.status !== previousDoc?.status) {
    if (doc.status === 'approved') {
      try {
        await req.payload.update({
          collection: 'events',
          id: eventId,
          data: { isVolunteering: true },
          context: { skipVolunteeringGuard: true },
          overrideAccess: true,
        })
      } catch (error) {
        req.payload.logger.error(`Failed to set isVolunteering after request ${doc.id} approval: ${error}`)
      }
      await notifyTeamOfDecision(req, doc, requesterId, eventId, true)
      writeAuditLog(req.payload, {
        action: 'volunteer-flag-requests.approve',
        actor: req.user?.id ?? null,
        targetCollection: 'volunteer-flag-requests',
        targetId: doc.id,
        metadata: { requestedBy: requesterId, event: eventId },
      })
    } else if (doc.status === 'rejected') {
      await notifyTeamOfDecision(req, doc, requesterId, eventId, false)
      writeAuditLog(req.payload, {
        action: 'volunteer-flag-requests.reject',
        actor: req.user?.id ?? null,
        targetCollection: 'volunteer-flag-requests',
        targetId: doc.id,
        metadata: { requestedBy: requesterId, event: eventId },
      })
    }
  }
}

export const VolunteerFlagRequests: CollectionConfig = {
  slug: 'volunteer-flag-requests',
  labels: {
    singular: 'Volunteer Flag Request',
    plural: 'Volunteer Flag Requests',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['event', 'requestedBy', 'status', 'updatedAt'],
  },
  access: {
    read: canReadOwnOrAdministered('requestedBy', 'event.municipality'),
    create: ({ req: { user } }) => Boolean(user),
    update: isPlatformOrMunicipalityAdmin('event.municipality'),
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
      name: 'requestedBy',
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
      ],
    },
    {
      name: 'reviewedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
    },
    {
      name: 'reviewedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
  ],
  hooks: {
    beforeValidate: [
      prepareRequest,
      ({ data, req, operation, originalDoc }) => {
        if (operation !== 'update' || !data) return data
        if (data.status && data.status !== originalDoc?.status) {
          data.reviewedBy = req.user?.id
          data.reviewedAt = new Date().toISOString()
        }
        return data
      },
    ],
    afterChange: [notifyOnRequestChange],
  },
  timestamps: true,
}
