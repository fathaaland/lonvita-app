import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canCreateForAdministeredMunicipality, canReadOwnOrAdministered, getAdministeredMunicipalityIds } from './access/shared'
import { escapeHtml, sendNotification } from './shared/notify'
import { ANONYMOUS_NAME } from './shared/anonymizeUser'

export const POOL_INVITATION_MESSAGE_MAX_LENGTH = 300

/** After a "no", the obec waits this long before asking the same person again. */
export const POOL_INVITATION_DECLINE_COOLDOWN_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

const relId = (value: unknown): number | null => {
  if (value == null) return null
  return Number(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/**
 * An obec's admin asks one of its residents to join the volunteer pool. Joining stays the person's
 * own consent: the invitation only asks — they accept by joining themselves (Profiles
 * acceptPoolInvitations), choosing what they help with and how organizers may reach them, or turn
 * it down. Nobody already in the pool is asked, nor twice at once, nor again too soon after a "no".
 */
const validateNewInvitation: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create') return data
  const { payload, user } = req
  if (!user) throw new APIError('Nejste přihlášeni.', 401)

  const inviteeId = relId(data.user)
  const municipalityId = relId(data.municipality)
  if (!inviteeId || !municipalityId) throw new APIError('Chybí, koho a za kterou obec zvete.', 400)
  if (inviteeId === Number(user.id)) throw new APIError('Do poolu se přihlásíte sami v profilu.', 400)

  const profile = (
    await payload.find({
      collection: 'profiles',
      where: { user: { equals: inviteeId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
  ).docs[0]
  if (!profile || profile.fullName === ANONYMOUS_NAME || relId(profile.municipality) !== municipalityId) {
    throw new APIError('Do poolu můžete zvát jen obyvatele své obce.', 400)
  }
  if (profile.isVolunteer) throw new APIError('Tenhle člověk už v poolu je.', 400)

  const earlier = await payload.find({
    collection: 'pool-invitations',
    where: {
      and: [
        { user: { equals: inviteeId } },
        { municipality: { equals: municipalityId } },
        {
          or: [
            { status: { equals: 'pending' } },
            {
              and: [
                { status: { equals: 'declined' } },
                { decidedAt: { greater_than: new Date(Date.now() - POOL_INVITATION_DECLINE_COOLDOWN_DAYS * DAY_MS).toISOString() } },
              ],
            },
          ],
        },
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (earlier.docs[0]?.status === 'pending') throw new APIError('Pozvánka už na odpověď čeká.', 400)
  if (earlier.docs[0]) {
    throw new APIError(
      `Pozvání nedávno odmítl(a) — znovu ho můžete poslat po ${POOL_INVITATION_DECLINE_COOLDOWN_DAYS} dnech.`,
      400,
    )
  }

  const message = typeof data.message === 'string' ? data.message.trim().slice(0, POOL_INVITATION_MESSAGE_MAX_LENGTH) : ''
  return { ...data, user: inviteeId, municipality: municipalityId, invitedBy: user.id, status: 'pending', message: message || null, decidedAt: null }
}

/**
 * Answering: the invited person declines (accepting is joining the pool — Profiles), the obec's
 * admin withdraws one still waiting. A decided invitation stays as it is.
 */
const guardDecision: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req, context }) => {
  if (operation !== 'update' || !originalDoc) return data
  if (data.status === undefined || data.status === originalDoc.status) return data
  if (originalDoc.status !== 'pending') throw new APIError('O pozvánce už bylo rozhodnuto.', 409)

  // Joining the pool accepts it (Profiles acceptPoolInvitations) — the one way to "accepted".
  if (!context.acceptingPoolInvitation) {
    const { user, payload } = req
    if (!user) throw new APIError('Nejste přihlášeni.', 401)
    const invitee = String(relId(originalDoc.user)) === String(user.id)
    if (data.status === 'declined') {
      if (!invitee) throw new APIError('Pozvánku může odmítnout jen pozvaný.', 403)
    } else if (data.status === 'withdrawn') {
      const administered = await getAdministeredMunicipalityIds(payload, user.id)
      if (user.role !== 'admin' && !administered.includes(String(relId(originalDoc.municipality)))) {
        throw new APIError('Pozvánku může stáhnout jen obec, která ji poslala.', 403)
      }
    } else {
      throw new APIError('Pozvánku přijmete tím, že se přihlásíte do poolu.', 400)
    }
  }
  data.decidedAt = new Date().toISOString()
  return data
}

const fullNameOf = async (req: Parameters<CollectionAfterChangeHook>[0]['req'], userId: number | null) => {
  if (!userId) return null
  const profile = await req.payload.find({
    collection: 'profiles',
    where: { user: { equals: userId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  return profile.docs[0]?.fullName?.trim() || null
}

/** The invited person hears of the invitation; the admin who sent it, of the answer. */
const notifyOnInvitation: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  try {
    const municipality = await req.payload
      .findByID({ collection: 'municipalities', id: relId(doc.municipality)!, depth: 0, overrideAccess: true, req })
      .catch(() => null)
    const obec = municipality?.name ?? 'Vaše obec'

    if (operation === 'create') {
      const note = doc.message ? ` Vzkaz: „${doc.message}“` : ''
      await sendNotification(req.payload, {
        userId: relId(doc.user)!,
        title: 'Pozvánka do poolu dobrovolníků',
        link: '/profil',
        message: `Obec ${obec} vás zve do poolu dobrovolníků — pořadatelé by vás pak mohli oslovit, když budou potřebovat pomoc.${note} Přijmout nebo odmítnout ji můžete v profilu.`,
        email: {
          subject: `Obec ${obec} vás zve do poolu dobrovolníků`,
          body:
            `<p>Obec <strong>${escapeHtml(obec)}</strong> vás zve do poolu dobrovolníků. Pořadatelé akcí by vás pak mohli oslovit, když budou potřebovat pomoc — jen tak, jak sami povolíte.</p>` +
            (doc.message ? `<blockquote>${escapeHtml(doc.message)}</blockquote>` : '') +
            '<p>Přijmout nebo odmítnout ji můžete v aplikaci v profilu.</p>',
        },
      })
      return doc
    }

    if (operation === 'update' && previousDoc?.status === 'pending' && (doc.status === 'accepted' || doc.status === 'declined')) {
      const who = (await fullNameOf(req, relId(doc.user))) ?? 'Pozvaný'
      const inviterId = relId(doc.invitedBy)
      if (inviterId) {
        await sendNotification(req.payload, {
          userId: inviterId,
          title: doc.status === 'accepted' ? 'Nový dobrovolník v poolu' : 'Pozvánka do poolu odmítnuta',
          link: '/admin-obce?tab=volunteers',
          message:
            doc.status === 'accepted'
              ? `${who} přijal(a) pozvánku a je teď v poolu dobrovolníků.`
              : `${who} pozvánku do poolu dobrovolníků odmítl(a).`,
        })
      }
    }
  } catch (error) {
    req.payload.logger.error(`Failed to notify about pool invitation ${doc.id}: ${error}`)
  }
  return doc
}

export const PoolInvitations: CollectionConfig = {
  slug: 'pool-invitations',
  labels: {
    singular: 'Pool Invitation',
    plural: 'Pool Invitations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'municipality', 'status', 'createdAt'],
    description: "An obec admin's invitation for a resident to join the volunteer pool — the resident accepts by joining.",
  },
  access: {
    read: canReadOwnOrAdministered('user'),
    create: canCreateForAdministeredMunicipality(),
    // The invited person and the obec's admins — what each may change is guardDecision's call.
    update: canReadOwnOrAdministered('user'),
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    // Only the answer changes later — who, where and what was said stay as sent.
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: { update: () => false },
      admin: { description: 'Who is invited.' },
    },
    { name: 'municipality', type: 'relationship', relationTo: 'municipalities', required: true, access: { update: () => false } },
    { name: 'invitedBy', type: 'relationship', relationTo: 'users', access: { update: () => false }, admin: { position: 'sidebar' } },
    { name: 'message', type: 'textarea', maxLength: POOL_INVITATION_MESSAGE_MAX_LENGTH, access: { update: () => false } },
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
    { name: 'decidedAt', type: 'date', admin: { position: 'sidebar' } },
  ],
  hooks: {
    beforeChange: [validateNewInvitation, guardDecision],
    afterChange: [notifyOnInvitation],
  },
  timestamps: true,
}
