import type { Access, CollectionAfterChangeHook, CollectionConfig, Where } from 'payload'

import { getAdministeredMunicipalityIds, isPlatformOrMunicipalityAdmin } from './access/shared'
import { getMunicipalityAdminUserIds, sendNotification } from './shared/notify'
import { writeAuditLog } from './shared/auditLog'

/** Brief §3 "Žádost organizátora o příznak Dobrovolnictví... schvaluje se odděleně od role
 * organizátora." The requester or an admin of the event's municipality may read it. */
const canReadOwnOrAdministered: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  const or: Where[] = [{ requestedBy: { equals: user.id } }]
  if (administeredIds.length > 0) or.push({ 'event.municipality': { in: administeredIds } })
  return { or }
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
        link: '/admin-obce',
        message: `Organizátor požádal o příznak Dobrovolnictví pro akci „${event.title}“.`,
        email: {
          subject: 'Nová žádost o příznak Dobrovolnictví',
          body: `<p>Organizátor požádal o příznak Dobrovolnictví pro akci <strong>${event.title}</strong> — vyřiďte to v sekci Žádosti v adminu obce.</p>`,
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
      sendNotification(req.payload, {
        userId: requesterId,
        title: 'Příznak Dobrovolnictví schválen',
        link: `/akce/${eventId}`,
        message: 'Vaše žádost o příznak Dobrovolnictví byla schválena.',
        email: {
          subject: 'Příznak Dobrovolnictví schválen',
          body: '<p>Vaše žádost o příznak Dobrovolnictví byla schválena.</p>',
        },
      })
      writeAuditLog(req.payload, {
        action: 'volunteer-flag-requests.approve',
        actor: req.user?.id ?? null,
        targetCollection: 'volunteer-flag-requests',
        targetId: doc.id,
        metadata: { requestedBy: requesterId, event: eventId },
      })
    } else if (doc.status === 'rejected') {
      sendNotification(req.payload, {
        userId: requesterId,
        title: 'Příznak Dobrovolnictví zamítnut',
        link: `/akce/${eventId}`,
        message: 'Vaše žádost o příznak Dobrovolnictví byla zamítnuta.',
        email: {
          subject: 'Příznak Dobrovolnictví zamítnut',
          body: '<p>Vaše žádost o příznak Dobrovolnictví byla bohužel zamítnuta.</p>',
        },
      })
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
    read: canReadOwnOrAdministered,
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
      async ({ data, req, operation }) => {
        if (!data?.event || !data?.requestedBy) return data
        if (operation !== 'create') return data

        const event = await req.payload.findByID({
          collection: 'events',
          id: data.event,
          depth: 0,
          overrideAccess: true,
        })
        const organizerId = typeof event.organizer === 'object' ? event.organizer.id : event.organizer
        const coOrganizerIds = (event.coOrganizers ?? []).map((c: number | { id: number }) =>
          typeof c === 'object' ? c.id : c,
        )
        const isOrganizerOfEvent =
          String(organizerId) === String(data.requestedBy) ||
          coOrganizerIds.some((id: number) => String(id) === String(data.requestedBy))
        if (!isOrganizerOfEvent) {
          throw new Error('Only the event organizer can request the volunteering flag for it.')
        }

        if (event.isVolunteering) {
          throw new Error('This event is already flagged as volunteering.')
        }

        const existing = await req.payload.find({
          collection: 'volunteer-flag-requests',
          where: { and: [{ event: { equals: data.event } }, { status: { equals: 'pending' } }] },
          limit: 1,
          overrideAccess: true,
        })
        if (existing.docs.length > 0) {
          throw new Error('There is already a pending volunteering-flag request for this event.')
        }

        return data
      },
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
