import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Payload,
} from 'payload'
import { APIError } from 'payload'

import { auditDeletion } from './shared/auditLog'
import { escapeHtml, getObecDeciders, sendNotificationToMany } from './shared/notify'
import { relationId } from '@/lib/relations'

const platformAdmin = ({ req: { user } }: { req: { user?: { role?: string | null } | null } }) =>
  user?.role === 'admin'

/** A region is 1–N obce, each in no other region; its main obec is one of them — the first, unless
 * the platform admin picked another. */
const validateMembers: CollectionBeforeValidateHook = async ({ data, req, originalDoc }) => {
  if (!data) return data
  const name = typeof data.name === 'string' ? data.name.trim() : (originalDoc?.name ?? '')
  if (!name) throw new APIError('Zadejte název mikroregionu.', 400)
  const members = [
    ...new Set(
      ((data.municipalities ?? originalDoc?.municipalities ?? []) as unknown[])
        .map(relationId)
        .filter((id): id is string => id !== null),
    ),
  ]
  if (members.length === 0) throw new APIError('Mikroregion musí mít aspoň jednu obec.', 400)

  const elsewhere = await req.payload.find({
    collection: 'microregions',
    where: {
      and: [
        { municipalities: { in: members } },
        ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
      ],
    },
    depth: 1,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (elsewhere.docs[0]) {
    throw new APIError(
      `Obec už patří do mikroregionu „${elsewhere.docs[0].name}“ — obec může být jen v jednom.`,
      400,
    )
  }

  const main = relationId(data.mainMunicipality ?? originalDoc?.mainMunicipality)
  return {
    ...data,
    name,
    municipalities: members.map(Number),
    mainMunicipality: Number(main && members.includes(main) ? main : members[0]),
  }
}

const memberIds = (doc: { municipalities?: unknown[] | null } | null | undefined): string[] =>
  ((doc?.municipalities ?? []) as unknown[]).map(relationId).filter((id): id is string => id !== null)

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} a ${names[names.length - 1]}`

/** Tells each obec's admins what changed for it — the volunteers and co-organizers they're offered
 * come from the region, so they mustn't learn about joining or leaving one only by noticing. */
async function notifyMembership(
  payload: Payload,
  regionName: string,
  before: string[],
  after: string[],
): Promise<void> {
  const joined = after.filter((id) => !before.includes(id))
  const left = before.filter((id) => !after.includes(id))
  if (joined.length === 0 && left.length === 0) return

  const all = [...new Set([...before, ...after])]
  const municipalities = await payload.find({
    collection: 'municipalities',
    where: { id: { in: all } },
    select: { name: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const nameOf = new Map(municipalities.docs.map((m) => [String(m.id), m.name]))
  const names = (ids: string[]) => joinNames(ids.map((id) => nameOf.get(id) ?? '').filter(Boolean))
  const region = `mikroregionu ${regionName}`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  // An obec without an admin is looked after by the platform admins — they hear it instead.
  const send = async (municipalityId: string, title: string, message: string) => {
    const { userIds, requestsLink } = await getObecDeciders(payload, municipalityId)
    const forPlatform = requestsLink.startsWith('/superadmin')
    const link = forPlatform ? '/superadmin' : '/admin-obce'
    const text = forPlatform ? `${message} (Obec ${nameOf.get(municipalityId) ?? ''} zatím nemá admina.)` : message
    await sendNotificationToMany(payload, userIds, {
      title,
      message: text,
      link,
      email: {
        subject: title,
        body: `<p>${escapeHtml(text)}</p><p><a href="${appUrl}${link}">${forPlatform ? 'Otevřít správu Lonvity' : 'Otevřít přehled obce'}</a></p>`,
      },
    })
  }

  const pairs = brokenPairs(before, after)
  const joint = await jointEventsAcross(payload, pairs)
  // The co-operations already under way run to their end as they are — each obec hears which.
  const runningFor = (id: string) => {
    const mine = [...new Set(joint.filter((e) => e.municipality === id || e.partner === id).map((e) => e.title))]
    if (mine.length === 0) return ''
    const listed = mine.slice(0, 3).map((t) => `„${t}“`).join(', ')
    return ` Společné akce, které už běží (${mine.length}: ${listed}${mine.length > 3 ? '…' : ''}), doběhnou ve stávající sestavě.`
  }

  await lapseInvitationsAcross(payload, pairs, regionName)

  for (const id of all) {
    const own = nameOf.get(id) ?? 'Obec'
    const others = after.filter((m) => m !== id)
    const sharing =
      others.length === 0
        ? 'Zatím v něm není jiná obec.'
        : `Akce, dobrovolníky a spolupořádání teď sdílíte s ${others.length === 1 ? 'obcí' : 'obcemi'} ${names(others)}.`
    if (joined.includes(id)) {
      await send(id, `${own} je v ${region}`, `Správce Lonvity zařadil obec ${own} do ${region}. ${sharing}`)
    } else if (left.includes(id)) {
      await send(
        id,
        `${own} už není v ${region}`,
        `Správce Lonvity vyřadil obec ${own} z ${region}. Akce, dobrovolníci i spolupořádání zůstávají zase jen v obci.${runningFor(id)}`,
      )
    } else {
      const changes = [
        joined.length > 0 ? `přibyla ${joined.length === 1 ? 'obec' : 'obce'} ${names(joined)}` : null,
        left.length > 0 ? `odešla ${left.length === 1 ? 'obec' : 'obce'} ${names(left)}` : null,
      ].filter(Boolean)
      await send(id, `Změna v ${region}`, `Do ${region} ${changes.join(' a ')}. ${sharing}${runningFor(id)}`)
    }
  }
}

/**
 * Upcoming events co-organized across the given pairs of obce — held in one obec and co-organized by
 * the other's own organization or one of its organizers'. `pairs` are [obec, obec] whose sharing ends.
 * They run on to their end as they are; this is what the change touches.
 */
export async function jointEventsAcross(
  payload: Payload,
  pairs: [string, string][],
): Promise<{ id: string; title: string; municipality: string; partner: string }[]> {
  if (pairs.length === 0) return []
  const obce = [...new Set(pairs.flat())]
  const organizations = await payload.find({
    collection: 'organizations',
    where: { municipality: { in: obce } },
    select: { municipality: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const obecOf = new Map(organizations.docs.map((o) => [String(o.id), relationId(o.municipality)]))
  const now = new Date().toISOString()
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { municipality: { in: obce } },
        { coOrganizations: { in: [...obecOf.keys()] } },
        { status: { not_equals: 'cancelled' } },
        { deletedAt: { exists: false } },
        {
          or: [
            { endDateTime: { greater_than_equal: now } },
            { and: [{ endDateTime: { exists: false } }, { dateTime: { greater_than_equal: now } }] },
          ],
        },
      ],
    },
    select: { title: true, municipality: true, coOrganizations: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const broken = new Set(pairs.flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]))
  const result: { id: string; title: string; municipality: string; partner: string }[] = []
  for (const e of events.docs) {
    const home = relationId(e.municipality)!
    for (const partner of new Set((e.coOrganizations ?? []).map((o) => obecOf.get(relationId(o) ?? '')))) {
      if (partner && broken.has(`${home}:${partner}`)) {
        result.push({ id: String(e.id), title: e.title, municipality: home, partner })
      }
    }
  }
  return result
}

/** The pairs of obce that shared a region before and no longer do. */
export function brokenPairs(before: string[], after: string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < before.length; i++) {
    for (let j = i + 1; j < before.length; j++) {
      if (!(after.includes(before[i]) && after.includes(before[j]))) pairs.push([before[i], before[j]])
    }
  }
  return pairs
}

/**
 * Invitations to co-organize across obce that no longer share a region lapse — accepting one would
 * fail anyway (Events resolveOrganizations). Whoever sent it hears why.
 */
async function lapseInvitationsAcross(payload: Payload, pairs: [string, string][], regionName: string) {
  if (pairs.length === 0) return
  const broken = new Set(pairs.flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]))
  const pending = await payload.find({
    collection: 'co-organizing-requests',
    where: {
      and: [
        { status: { equals: 'pending' } },
        { expiresAt: { greater_than: new Date().toISOString() } },
        { municipality: { in: [...new Set(pairs.flat())] } },
      ],
    },
    depth: 1,
    pagination: false,
    overrideAccess: true,
  })
  for (const request of pending.docs) {
    const event = typeof request.event === 'object' ? request.event : null
    const home = event ? relationId(event.municipality) : null
    const invited = relationId(request.municipality)
    if (!home || !invited || !broken.has(`${home}:${invited}`)) continue
    await payload.update({
      collection: 'co-organizing-requests',
      id: request.id,
      data: { expiresAt: new Date().toISOString() },
      overrideAccess: true,
    })
    await sendNotificationToMany(payload, [relationId(request.requestedBy)!], {
      title: 'Pozvánka ke spolupořádání zrušena',
      link: event ? `/akce/${event.id}` : undefined,
      message: `Pozvánka pro ${request.organizationName} ke spolupořádání akce „${request.eventTitle}“ je zrušená — obce už nejsou spolu v mikroregionu ${regionName}.`,
    })
  }
}

const notifyOnChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  await notifyMembership(req.payload, doc.name, operation === 'create' ? [] : memberIds(previousDoc), memberIds(doc))
  return doc
}

const notifyOnDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
  await notifyMembership(req.payload, doc.name, memberIds(doc), [])
}

/**
 * Mikroregion — obce sharing one view (lib/microregions): each other's events, volunteers and
 * co-organizing. Kept by the platform's admins (the superadmin panel); anyone may read which obce
 * belong together, as the event list does.
 */
export const Microregions: CollectionConfig = {
  slug: 'microregions',
  labels: { singular: 'Microregion', plural: 'Microregions' },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'mainMunicipality', 'municipalities'] },
  access: {
    read: () => true,
    create: platformAdmin,
    update: platformAdmin,
    delete: platformAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'mainMunicipality', type: 'relationship', relationTo: 'municipalities' },
    {
      name: 'municipalities',
      type: 'relationship',
      relationTo: 'municipalities',
      hasMany: true,
      required: true,
      index: true,
    },
  ],
  hooks: {
    beforeValidate: [validateMembers],
    afterChange: [notifyOnChange],
    afterDelete: [notifyOnDelete, auditDeletion<{ name?: string }>((doc) => ({ metadata: { name: doc.name } }))],
  },
  timestamps: true,
}
