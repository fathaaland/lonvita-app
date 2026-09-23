import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canReadOwnOrAdministered, isPlatformOrMunicipalityAdmin } from './access/shared'
import { administeredIdsFor, eventOrganizerIds, obecRole } from './Events'
import { ensureMunicipalityOrganization } from './Organizations'
import { escapeHtml, getMunicipalityAdminUserIds, sendNotification } from './shared/notify'
import { writeAuditLog } from './shared/auditLog'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * Everything about a new request is derived from the event and the signed-in user — the client
 * only names the event. Only a pořadatel/spolupořadatel may ask, and only for an event the obec
 * neither runs nor already co-organizes; the obec's admins add the obec themselves, directly.
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
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce neexistuje nebo už byla zrušena.', 404)
  }
  if (!eventOrganizerIds(event).includes(String(user.id))) {
    throw new APIError('O spolupořádání může obec požádat jen pořadatel nebo spolupořadatel akce.', 403)
  }
  const municipalityId = relationId(event.municipality)!
  if ((await administeredIdsFor(req, user.id)).includes(municipalityId)) {
    throw new APIError('Jako admin obce přidejte obec za spolupořadatele rovnou.', 400)
  }
  const role = await obecRole(req, event)
  if (role.runs) throw new APIError('Tuhle akci pořádá obec sama.', 400)
  if (role.coOrganizes) throw new APIError('Obec už akci spolupořádá.', 400)

  const pending = await payload.find({
    collection: 'co-organizing-requests',
    where: { and: [{ event: { equals: event.id } }, { status: { equals: 'pending' } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (pending.docs.length > 0) throw new APIError('O spolupořádání téhle akce už obec žádáte.', 400)

  return {
    event: event.id,
    eventTitle: event.title,
    municipality: Number(municipalityId),
    requestedBy: user.id,
    status: 'pending',
  }
}

/**
 * A decision is final, and approving puts the obec on the event right away — in the same
 * transaction, so an approval can never be recorded without the obec actually co-organizing.
 */
const applyDecision: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (operation !== 'update' || !data || !originalDoc || data.status === undefined) return data
  if (data.status === originalDoc.status) return data
  if (originalDoc.status !== 'pending') throw new APIError('O žádosti už bylo rozhodnuto.', 409)

  data.reviewedBy = req.user?.id ?? null
  data.reviewedAt = new Date().toISOString()
  if (data.status !== 'approved') return data

  const eventId = relationId(originalDoc.event)
  const event = eventId
    ? await req.payload
        .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce už byla zrušena — žádost můžete jen zamítnout.', 409)
  }
  if ((await obecRole(req, event)).coOrganizes) return data

  const obecOrganizationId = await ensureMunicipalityOrganization(req, relationId(event.municipality)!)
  await req.payload.update({
    collection: 'events',
    id: event.id,
    data: {
      coOrganizations: [...(event.coOrganizations ?? []).map((o) => Number(relationId(o))), obecOrganizationId],
    },
    overrideAccess: true,
    context: { obecCoOrganizingApproved: true, skipFinishedAutoUpdate: true },
    req,
  })
  return data
}

const notifyOnRequestChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const requesterId = relationId(doc.requestedBy)!
  const eventId = relationId(doc.event)

  if (operation === 'create') {
    for (const adminId of await getMunicipalityAdminUserIds(req.payload, relationId(doc.municipality)!)) {
      sendNotification(req.payload, {
        userId: adminId,
        title: 'Žádost o spolupořádání akce',
        link: '/admin-obce',
        message: `Pořadatel žádá obec o spolupořádání akce „${doc.eventTitle}“.`,
        email: {
          subject: 'Žádost o spolupořádání akce',
          body: `<p>Pořadatel žádá obec o spolupořádání akce <strong>${escapeHtml(doc.eventTitle)}</strong> — vyřiďte to v sekci Žádosti v adminu obce.</p>`,
        },
      })
    }
    return doc
  }

  if (operation !== 'update' || doc.status === previousDoc?.status) return doc
  const approved = doc.status === 'approved'
  sendNotification(req.payload, {
    userId: requesterId,
    title: approved ? 'Obec akci spolupořádá' : 'Obec spolupořádání odmítla',
    link: `/akce/${eventId}`,
    message: approved
      ? `Obec souhlasila se spolupořádáním akce „${doc.eventTitle}“ a je u ní teď uvedená jako spolupořadatel.`
      : `Obec akci „${doc.eventTitle}“ spolupořádat nebude.`,
  })
  writeAuditLog(req.payload, {
    action: approved ? 'co-organizing-requests.approve' : 'co-organizing-requests.reject',
    actor: req.user?.id ?? null,
    targetCollection: 'co-organizing-requests',
    targetId: doc.id,
    municipality: Number(relationId(doc.municipality)) || null,
    metadata: { requestedBy: requesterId, event: eventId },
  })
  return doc
}

/**
 * A pořadatel asks the obec to co-organize their event — the obec only ever joins with its own
 * consent (Events resolveOrganizations lets a pořadatel add every other organization directly).
 * Any of the obec's admins approves (the obec's organization is added to the event) or rejects.
 * The other way round needs no request: an obec admin adds a café to the obec's event directly.
 */
export const CoOrganizingRequests: CollectionConfig = {
  slug: 'co-organizing-requests',
  labels: {
    singular: 'Co-organizing Request',
    plural: 'Co-organizing Requests',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['eventTitle', 'requestedBy', 'status', 'updatedAt'],
  },
  access: {
    read: canReadOwnOrAdministered('requestedBy'),
    create: ({ req: { user } }) => Boolean(user),
    update: isPlatformOrMunicipalityAdmin(),
    delete: isPlatformOrMunicipalityAdmin(),
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
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
    beforeValidate: [prepareRequest],
    beforeChange: [applyDecision],
    afterChange: [notifyOnRequestChange],
  },
  timestamps: true,
}
