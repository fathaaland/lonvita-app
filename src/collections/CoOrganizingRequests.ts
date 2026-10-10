import type {
  Access,
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  PayloadRequest,
  Where,
} from 'payload'
import { APIError } from 'payload'

import { getAdministeredMunicipalityIds, isPlatformOrMunicipalityAdmin } from './access/shared'
import { administeredIdsFor, mayEditEvent } from './Events'
import { escapeHtml, getEventTeamUserIds, getObecDeciders, sendNotification, sendNotificationToMany } from './shared/notify'
import { writeAuditLog } from './shared/auditLog'
import { hasEventEnded } from '@/lib/eventEnded'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

/** How long an invited organization has to accept — never past the event's start. Whoever doesn't
 * accept in time isn't on the event; the inviter may invite them again. */
export const CO_ORGANIZING_INVITATION_HOURS = 24

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** The requester, whoever answers for the invited organization (its owner, or for the obec its
 * admins — who also see every invitation in their obec) and a platform admin. */
const canReadRequest: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const or: Where[] = [{ requestedBy: { equals: user.id } }, { organizationOwner: { equals: user.id } }]
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length > 0) or.push({ municipality: { in: administeredIds } })
  const where: Where = { or }
  return where
}

/** Only whoever answers for the invited organization decides: its owner, or — for the obec's own
 * organization, which has none — any of the obec's admins. A platform admin everywhere. */
const canDecideRequest: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  const or: Where[] = [{ organizationOwner: { equals: user.id } }]
  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length > 0) {
    or.push({ and: [{ organizationOwner: { exists: false } }, { municipality: { in: administeredIds } }] })
  }
  const where: Where = { or }
  return where
}

/** Whether `user` answers for the organization themselves — then inviting it is their consent. */
async function answersFor(
  req: PayloadRequest,
  user: { id: number | string },
  organization: { type: string; owner?: unknown; municipality: unknown },
): Promise<boolean> {
  if (organization.type !== MUNICIPALITY_ORGANIZATION_TYPE) return relationId(organization.owner) === String(user.id)
  return (await administeredIdsFor(req, user.id)).includes(relationId(organization.municipality) ?? '')
}

/**
 * Everything about a new invitation is derived from the event, the organization and the signed-in
 * user — the client only names the first two. Whoever may edit the event invites (with the obec on
 * it, that's only the obec's admins — see Events lockedEventIds); the organization has to be one of
 * the obec's, not on the event yet, and — unless it's the obec's own — still organizing there.
 * Someone answering for the invited organization themselves has consented by inviting, so theirs is
 * approved on the spot — except the obec: it never puts itself on someone's event, its pořadatel
 * has to invite it. And an obec that has stepped off the event (Events obecLeftAt) isn't invited back.
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
  if (!(await mayEditEvent(req, user, event))) {
    throw new APIError('Ke spolupořádání může zvát jen ten, kdo smí akci upravovat.', 403)
  }

  const municipalityId = relationId(event.municipality)!
  const organizationId = relationId(data.organization)
  const organization = organizationId
    ? await payload
        .findByID({ collection: 'organizations', id: organizationId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  if (!organization || organization.deletedAt || relationId(organization.municipality) !== municipalityId) {
    throw new APIError('Spolupořadatelem může být jen organizace z téhle obce.', 400)
  }
  const isObec = organization.type === MUNICIPALITY_ORGANIZATION_TYPE
  if (relationId(event.organization) === String(organization.id)) {
    throw new APIError(isObec ? 'Tuhle akci pořádá obec sama.' : 'Tahle organizace akci už pořádá.', 400)
  }
  if ((event.coOrganizations ?? []).map(relationId).includes(String(organization.id))) {
    throw new APIError(isObec ? 'Obec už akci spolupořádá.' : 'Tahle organizace už akci spolupořádá.', 400)
  }
  const answers = await answersFor(req, user, organization)
  if (isObec && answers && user.role !== 'admin') {
    throw new APIError('Obec se ke spolupořádání akce přidat sama nemůže — pozvat ji musí pořadatel akce.', 403)
  }
  if (isObec && event.obecLeftAt) {
    throw new APIError('Obec spolupořádání téhle akce ukončila — vrátit se k ní už nejde.', 400)
  }

  const pending = await payload.find({
    collection: 'co-organizing-requests',
    where: {
      and: [
        { event: { equals: event.id } },
        { organization: { equals: organization.id } },
        { status: { equals: 'pending' } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (pending.docs.length > 0) throw new APIError('Pozvánka pro tuhle organizaci už čeká na odpověď.', 400)

  // An event already under way (a multi-day one) has no start left to cap it with.
  const startsAt = new Date(event.dateTime).getTime()
  const expiresAt = Math.min(
    Date.now() + CO_ORGANIZING_INVITATION_HOURS * 60 * 60 * 1000,
    startsAt > Date.now() ? startsAt : Number.POSITIVE_INFINITY,
  )

  return {
    event: event.id,
    eventTitle: event.title,
    municipality: Number(municipalityId),
    organization: organization.id,
    organizationName: organization.name,
    organizationOwner: isObec ? null : Number(relationId(organization.owner)),
    requestedBy: user.id,
    status: answers ? 'approved' : 'pending',
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

/**
 * A decision is final, and approving puts the organization on the event right away — in the same
 * transaction, so an approval can never be recorded without the organization actually
 * co-organizing. Events resolveOrganizations re-checks it may (still in the obec, still organizing).
 */
const applyDecision: CollectionBeforeChangeHook = async ({ data, req, operation, originalDoc }) => {
  if (!data) return data
  if (operation === 'update') {
    if (!originalDoc || data.status === undefined || data.status === originalDoc.status) return data
    // originalDoc carries the stored status — a lapsed one may still read "pending" there.
    const lapsed =
      originalDoc.status === 'pending' &&
      originalDoc.expiresAt &&
      new Date(originalDoc.expiresAt).getTime() <= Date.now()
    if (lapsed || originalDoc.status === 'expired' || data.status === 'expired') {
      throw new APIError('Pozvánka už vypršela — o spolupořádání musí pořadatel požádat znovu.', 409)
    }
    if (originalDoc.status !== 'pending') throw new APIError('O pozvánce už bylo rozhodnuto.', 409)
  }
  if (operation === 'create' && data.status !== 'approved') return data

  data.reviewedBy = req.user?.id ?? null
  data.reviewedAt = new Date().toISOString()
  if (data.status !== 'approved') return data

  const eventId = relationId(originalDoc?.event ?? data.event)
  const organizationId = Number(relationId(originalDoc?.organization ?? data.organization))
  const event = eventId
    ? await req.payload
        .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  if (!event || event.deletedAt || event.status === 'cancelled') {
    throw new APIError('Akce už byla zrušena — pozvánku můžete jen odmítnout.', 409)
  }
  // A held event is history — nobody joins it as a spolupořadatel after the fact.
  if (hasEventEnded(event.dateTime, event.endDateTime)) {
    throw new APIError('Akce už proběhla — pozvánku můžete jen odmítnout.', 409)
  }
  const current = (event.coOrganizations ?? []).map((o) => Number(relationId(o)))
  if (current.includes(organizationId)) return data

  await req.payload.update({
    collection: 'events',
    id: event.id,
    data: { coOrganizations: [...current, organizationId] },
    overrideAccess: true,
    context: { coOrganizingApproved: true },
    req,
  })
  return data
}

const notifyOnRequestChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const requesterId = relationId(doc.requestedBy)!
  const eventId = relationId(doc.event)
  const ownerId = relationId(doc.organizationOwner)
  const title = escapeHtml(doc.eventTitle)

  // An owner inviting their own organization has consented by inviting (prepareRequest) — still
  // news to everyone else on the event.
  const approvedOnCreate = operation === 'create' && doc.status === 'approved'
  if (operation === 'create' && !approvedOnCreate) {
    const requester = await req.payload.find({
      collection: 'profiles',
      where: { user: { equals: requesterId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    const who = requester.docs[0]?.fullName || 'Pořadatel'
    const obec = ownerId ? null : await getObecDeciders(req.payload, relationId(doc.municipality)!)
    const recipients = ownerId ? [ownerId] : obec!.userIds
    const invited = ownerId ? `vaši organizaci ${doc.organizationName}` : 'obec'
    const where = ownerId ? 'v sekci Organizace' : 'v sekci Žádosti'
    for (const userId of recipients) {
      sendNotification(req.payload, {
        userId,
        title: 'Pozvánka ke spolupořádání akce',
        link: ownerId ? '/organizace' : obec!.requestsLink,
        message: `${who} zve ${invited} ke spolupořádání akce „${doc.eventTitle}“.`,
        email: {
          subject: `Pozvánka ke spolupořádání akce: ${doc.eventTitle}`,
          body: `<p>${escapeHtml(who)} zve ${escapeHtml(invited)} ke spolupořádání akce <strong>${title}</strong> — přijměte nebo odmítněte ji ${where}.</p>`,
        },
      })
    }
    return doc
  }

  if (!approvedOnCreate && (operation !== 'update' || doc.status === previousDoc?.status)) return doc
  const approved = doc.status === 'approved'
  const who = ownerId ? `Organizace ${doc.organizationName}` : 'Obec'
  // Whoever invited, and everyone running the event — on approval that includes the organization
  // that just joined (and the obec's other admins), though not whoever made the decision.
  const event = eventId
    ? await req.payload
        .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
    : null
  const team = event ? await getEventTeamUserIds(req.payload, event, { req }) : []
  const recipients = [...new Set([requesterId, ...team])].filter((id) => id !== String(req.user?.id))
  sendNotificationToMany(req.payload, recipients, {
    title: approved ? `${who} akci spolupořádá` : `${who} spolupořádání odmítla`,
    link: `/akce/${eventId}`,
    message: approved
      ? `${who} přijala pozvánku ke spolupořádání akce „${doc.eventTitle}“ a je u ní teď uvedená jako spolupořadatel.`
      : `${who} akci „${doc.eventTitle}“ spolupořádat nebude.`,
  })
  writeAuditLog(req.payload, {
    action: approved ? 'co-organizing-requests.approve' : 'co-organizing-requests.reject',
    actor: req.user?.id ?? null,
    targetCollection: 'co-organizing-requests',
    targetId: doc.id,
    municipality: Number(relationId(doc.municipality)) || null,
    metadata: { requestedBy: requesterId, event: eventId, organization: relationId(doc.organization) },
  })
  return doc
}

/** A pending invitation past its `expiresAt` reads back as "expired" straight away (like
 * EventDeletionRequests); the worker's sync-statuses job writes it down. */
const deriveExpiredStatus: CollectionAfterReadHook = ({ doc }) => {
  if (doc.status !== 'pending' || !doc.expiresAt || new Date(doc.expiresAt).getTime() > Date.now()) return doc
  return { ...doc, status: 'expired' }
}

const fixedAfterCreate = { update: () => false }

/**
 * An invitation for an organization to co-organize an event — nobody becomes a spolupořadatel
 * without their own consent (brief §4 "Spolupořadatelství"). Whoever may edit the event invites;
 * the organization's owner accepts or declines — for the obec's own organization, any of the obec's
 * admins — within CO_ORGANIZING_INVITATION_HOURS, or the invitation lapses. Accepting adds the organization to the event (Events.coOrganizations); with the obec on
 * it, only the obec edits the event from then on (Events lockedEventIds).
 */
export const CoOrganizingRequests: CollectionConfig = {
  slug: 'co-organizing-requests',
  labels: {
    singular: 'Co-organizing Request',
    plural: 'Co-organizing Requests',
  },
  admin: {
    useAsTitle: 'eventTitle',
    defaultColumns: ['eventTitle', 'organizationName', 'requestedBy', 'status', 'updatedAt'],
  },
  access: {
    read: canReadRequest,
    create: ({ req: { user } }) => Boolean(user),
    update: canDecideRequest,
    delete: isPlatformOrMunicipalityAdmin(),
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
      access: fixedAfterCreate,
    },
    {
      name: 'eventTitle',
      type: 'text',
      required: true,
      access: fixedAfterCreate,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      access: fixedAfterCreate,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      access: fixedAfterCreate,
      admin: { description: 'The organization invited to co-organize the event.' },
    },
    {
      name: 'organizationName',
      type: 'text',
      required: true,
      access: fixedAfterCreate,
    },
    {
      name: 'organizationOwner',
      type: 'relationship',
      relationTo: 'users',
      access: fixedAfterCreate,
      admin: {
        description:
          "Who accepts or declines — the invited organization's owner. Empty for the obec's own organization: any of its admins does.",
      },
    },
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: fixedAfterCreate,
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
        { label: 'Expired', value: 'expired' },
      ],
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      access: fixedAfterCreate,
      admin: { description: 'Unanswered by then, the invitation lapses — 24 h, never past the event start.' },
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
    afterRead: [deriveExpiredStatus],
  },
  timestamps: true,
}
