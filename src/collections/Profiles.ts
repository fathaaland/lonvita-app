import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type Payload,
  type PayloadRequest,
} from 'payload'

import {
  canReadDateOfBirth,
  canReadProfile,
  canReadOwnProfileField,
  canReadPhone,
  canReadVolunteerFields,
  isLoggedIn,
} from './access/shared'
import { deletedAtField, adminOnlyDelete, notDeleted } from './shared/softDelete'
import { getEventTeamUserIds, sendNotificationToMany } from './shared/notify'
import { PARTICIPANTS_ONLY } from './Registrations'
import { INVALID_PHONE_MESSAGE, PHONE_TAKEN_MESSAGE, toE164 } from '@/lib/phone'
import { requiredRelationNumber } from '@/lib/relations'

/** Whether another account already has `phone` (E.164) — the superadmin's create-user route asks
 * before it creates anything, the hook below on every write. */
export async function isPhoneTaken(
  payload: Payload,
  phone: string,
  exceptProfileId?: number | string,
  req?: PayloadRequest,
): Promise<boolean> {
  const { totalDocs } = await payload.count({
    collection: 'profiles',
    where: {
      and: [
        { phone: { equals: phone } },
        ...(exceptProfileId !== undefined ? [{ id: { not_equals: exceptProfileId } }] : []),
      ],
    },
    overrideAccess: true,
    req,
  })
  return totalDocs > 0
}

/**
 * One phone number, one account — a cancelled event is announced by SMS, and a number shared by
 * two accounts would tell one person about the other's events. Stored the way the SMS needs it
 * (E.164), so "735 929 442" and "+420 735 929 442" are recognised as the same number.
 */
const ensureUniquePhone: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data || !('phone' in data)) return data
  const raw = String(data.phone ?? '').trim()
  if (!raw) {
    data.phone = null
    return data
  }
  const phone = toE164(raw)
  if (!phone) throw new APIError(INVALID_PHONE_MESSAGE, 400, undefined, true)
  data.phone = phone
  if (phone !== originalDoc?.phone && (await isPhoneTaken(req.payload, phone, originalDoc?.id, req))) {
    throw new APIError(PHONE_TAKEN_MESSAGE, 400, undefined, true)
  }
  return data
}

/**
 * The volunteer pool is one for the whole platform — whoever organizes anywhere may reach out to a
 * volunteer, through the channels the volunteer allowed: e-mail, phone, or both, never neither. Each
 * allowed channel needs its contact filled in. Leaving the pool clears nothing but the flag, so
 * rejoining later starts from what they had.
 */
const validateVolunteerContact: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const value = (key: string) => (key in data ? data[key] : originalDoc?.[key])
  if (!value('isVolunteer')) return data

  if (!value('volunteerMunicipality')) {
    throw new APIError('Vyberte na mapě obec, kde chcete pomáhat.', 400, undefined, true)
  }
  const allowEmail = Boolean(value('volunteerAllowEmail'))
  const allowPhone = Boolean(value('volunteerAllowPhone'))
  if (!allowEmail && !allowPhone) {
    throw new APIError('Vyberte, jak vás mohou pořadatelé oslovit — e-mailem, telefonem, nebo obojím.', 400, undefined, true)
  }
  const email = String(value('volunteerContactEmail') ?? '').trim()
  const phone = String(value('volunteerContactPhone') ?? '').trim()
  if (allowEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new APIError('Vyplňte kontaktní e-mail.', 400, undefined, true)
  }
  if (allowPhone && phone.replace(/\D/g, '').length < 9) {
    throw new APIError('Vyplňte kontaktní telefon.', 400, undefined, true)
  }
  if ('volunteerContactEmail' in data) data.volunteerContactEmail = email || null
  if ('volunteerContactPhone' in data) data.volunteerContactPhone = phone || null
  if (data.isVolunteer === true && !originalDoc?.isVolunteer && !value('volunteerSince')) {
    data.volunteerSince = new Date().toISOString()
  }
  return data
}

/** Joining the pool is the answer to every invitation still waiting for one (PoolInvitations) —
 * the obec that asked hears they said yes. */
const acceptPoolInvitations: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !doc.isVolunteer || previousDoc?.isVolunteer) return doc
  try {
    const pending = await req.payload.find({
      collection: 'pool-invitations',
      where: { and: [{ user: { equals: requiredRelationNumber(doc.user) } }, { status: { equals: 'pending' } }] },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
    for (const invitation of pending.docs) {
      await req.payload.update({
        collection: 'pool-invitations',
        id: invitation.id,
        data: { status: 'accepted' },
        overrideAccess: true,
        context: { acceptingPoolInvitation: true },
        req,
      })
    }
  } catch (error) {
    req.payload.logger.error(`Failed to accept pool invitations for profile ${doc.id}: ${error}`)
  }
  return doc
}

/**
 * Leaving the pool needs nobody's say-so — but the organizers counting on the volunteer must hear
 * of it. Pending invitations and offers to help are withdrawn (the organizers told). On every upcoming event the
 * volunteer helps on they stop being a volunteer: they stay on it as a participant where a place is
 * free, and drop off it where the event is full (a volunteer never took a place, so keeping them
 * would overfill it). The event's organizers get an in-app alert saying which. The volunteer is told
 * all of this before they confirm (VolunteerCard).
 */
const handleLeavingPool: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || doc.isVolunteer || !previousDoc?.isVolunteer) return doc
  const { payload } = req
  const userId = requiredRelationNumber(doc.user)
  const who = doc.fullName || 'Dobrovolník'

  const pending = await payload.find({
    collection: 'volunteer-invitations',
    where: { and: [{ volunteer: { equals: userId } }, { status: { equals: 'pending' } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const invitation of pending.docs) {
    await payload.update({
      collection: 'volunteer-invitations',
      id: invitation.id,
      data: { status: 'withdrawn' },
      overrideAccess: true,
      context: { withdrawingVolunteerInvitations: true },
      req,
    })
    const invitedFor = await payload
      .findByID({ collection: 'events', id: requiredRelationNumber(invitation.event), depth: 0, overrideAccess: true, req })
      .catch(() => null)
    const team = invitedFor ? await getEventTeamUserIds(payload, invitedFor, { exclude: [userId], req }) : []
    sendNotificationToMany(payload, [...new Set([String(requiredRelationNumber(invitation.invitedBy)), ...team])], {
      title: invitation.kind === 'application' ? 'Nabídka dobrovolníka zrušena' : 'Pozvánka dobrovolníka zrušena',
      link: `/akce/${requiredRelationNumber(invitation.event)}`,
      message:
        invitation.kind === 'application'
          ? `${who} odešel/odešla z poolu dobrovolníků — nabídka pomoci na akci „${invitation.eventTitle}“ už neplatí.`
          : `${who} odešel/odešla z poolu dobrovolníků — pozvánka na akci „${invitation.eventTitle}“ už neplatí.`,
    })
  }

  const helping = await payload.find({
    collection: 'registrations',
    where: {
      and: [
        { user: { equals: userId } },
        { role: { equals: 'volunteer' } },
        { status: { in: ['pending', 'approved'] } },
        { deletedAt: { exists: false } },
      ],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (helping.docs.length === 0) return doc
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { id: { in: helping.docs.map((r) => requiredRelationNumber(r.event)) } },
        { dateTime: { greater_than: new Date().toISOString() } },
        { status: { not_equals: 'cancelled' } },
        notDeleted,
      ],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const event of events.docs) {
    const registration = helping.docs.find((r) => requiredRelationNumber(r.event) === event.id)!
    const taken = await payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: event.id } }, { status: { equals: 'approved' } }, PARTICIPANTS_ONLY] },
      overrideAccess: true,
      req,
    })
    const staysAsParticipant = taken.totalDocs < event.capacity
    await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: staysAsParticipant ? { role: 'participant' } : { status: 'cancelled' },
      overrideAccess: true,
      context: { leavingVolunteerPool: true },
      req,
    })

    sendNotificationToMany(payload, await getEventTeamUserIds(payload, event, { exclude: [userId], req }), {
      title: 'Dobrovolník odešel z poolu',
      link: `/spravovat/${event.id}`,
      message: staysAsParticipant
        ? `${who} odešel/odešla z poolu dobrovolníků. Na akci „${event.title}“ už nepomáhá — zůstává přihlášený jako účastník.`
        : `${who} odešel/odešla z poolu dobrovolníků. Na akci „${event.title}“ už nepomáhá, a protože je akce plná, z akce se odhlásil.`,
    })
  }
  return doc
}

export const Profiles: CollectionConfig = {
  slug: 'profiles',
  labels: {
    singular: 'Profile',
    plural: 'Profiles',
  },
  admin: {
    useAsTitle: 'fullName',
    defaultColumns: ['fullName', 'municipality', 'updatedAt'],
  },
  access: {
    read: async (args) => {
      const readable = await canReadProfile(args)
      if (!readable) return false
      return readable === true ? notDeleted : { and: [notDeleted, readable] }
    },
    create: isLoggedIn,
    update: ({ req: { user } }) => {
      if (!user) return false
      // A platform superadmin edits other people's profiles from the "Uživatelé" tab
      // (the pencil next to each account); everyone else may only touch their own.
      if (user.role === 'admin') return true
      return { user: { equals: user.id } }
    },
    delete: adminOnlyDelete,
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      unique: true,
      admin: {
        description: '1:1 link to the account this profile belongs to.',
      },
    },
    {
      name: 'fullName',
      type: 'text',
      required: true,
    },
    {
      name: 'avatar',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'Profile photo shown instead of initials. Pre-filled from Google on the first Google sign-in.',
      },
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      admin: {
        description:
          'The user\'s home municipality. Empty = "bez obce" (their town doesn\'t use Lonvita yet) — they browse and can register for events across every municipality.',
      },
    },
    {
      name: 'phone',
      type: 'text',
      access: { read: canReadPhone },
    },
    {
      name: 'phoneVerified',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Brief §8 "přidání a ověření tel. čísla pro GoSMS" — set once an OTP sent to `phone` is confirmed.',
        position: 'sidebar',
      },
    },
    {
      name: 'notifyEmail',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Brief §7 "Preferovaný kanál notifikací... e-mail defaultně."',
      },
    },
    {
      name: 'notifyInApp',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Brief §7 "...aplikace volitelně."',
      },
    },
    {
      name: 'dateOfBirth',
      type: 'date',
      access: { read: canReadDateOfBirth },
    },
    {
      // Set by shared/anonymizeUser in place of the date of birth, which goes — the obec's overview
      // keeps counting its residents aged 50+ (Datavita) without knowing anyone's birthday.
      name: 'over50',
      type: 'checkbox',
      access: { read: canReadDateOfBirth, create: () => false, update: () => false },
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'gender',
      type: 'select',
      access: { read: canReadOwnProfileField },
      options: [
        { label: 'Žena', value: 'zena' },
        { label: 'Muž', value: 'muz' },
        { label: 'Jiné', value: 'jine' },
        { label: 'Neuvedeno', value: 'neuvedeno' },
      ],
    },
    {
      name: 'interests',
      type: 'relationship',
      access: { read: canReadOwnProfileField },
      relationTo: 'event-categories',
      hasMany: true,
    },
    {
      name: 'homeArea',
      type: 'relationship',
      access: { read: canReadOwnProfileField },
      relationTo: 'municipality-areas',
      admin: {
        description: 'Neighborhood within the municipality, chosen during onboarding.',
      },
    },
    {
      name: 'onboardingCompleted',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'isVolunteer',
      access: { read: canReadVolunteerFields },
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'volunteerFocus',
      access: { read: canReadVolunteerFields },
      type: 'text',
      hasMany: true,
    },
    {
      name: 'volunteerNote',
      access: { read: canReadVolunteerFields },
      type: 'textarea',
    },
    {
      name: 'volunteerSince',
      access: { read: canReadVolunteerFields },
      type: 'date',
    },
    {
      name: 'volunteerMunicipality',
      access: { read: canReadVolunteerFields },
      type: 'relationship',
      relationTo: 'municipalities',
      admin: {
        description:
          "Where the volunteer helps — what puts them on the organizers' volunteer map. Prefilled from the home obec; someone \"bez obce\" picks one on joining.",
      },
    },
    {
      name: 'volunteerAllowEmail',
      access: { read: canReadVolunteerFields },
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Pořadatelé mohou dobrovolníka oslovit e-mailem (volunteerContactEmail).' },
    },
    {
      name: 'volunteerContactEmail',
      access: { read: canReadVolunteerFields },
      type: 'email',
      admin: {
        description: "The address organizers write to — prefilled from the account, but changing it doesn't touch the sign-in e-mail.",
      },
    },
    {
      name: 'volunteerAllowPhone',
      access: { read: canReadVolunteerFields },
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Pořadatelé mohou dobrovolníka oslovit telefonem (volunteerContactPhone).' },
    },
    {
      name: 'volunteerContactPhone',
      access: { read: canReadVolunteerFields },
      type: 'text',
      admin: {
        description: "The number organizers call — separate from `phone`, which event cancellation SMS go to.",
      },
    },
    deletedAtField,
  ],
  hooks: {
    beforeChange: [validateVolunteerContact, ensureUniquePhone],
    afterChange: [handleLeavingPool, acceptPoolInvitations],
  },
  timestamps: true,
}
