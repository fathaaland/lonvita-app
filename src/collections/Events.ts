import type { Access, CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'
import { APIError } from 'payload'

import {
  getAdministeredMunicipalityIds,
  getOrganizerMunicipalityIds,
} from './access/shared'
import { notDeleted } from './shared/softDelete'
import { sendNotification } from './shared/notify'
import { cancelEventReminders, rescheduleEventReminders, scheduleAttendanceReminder } from './shared/reminders'
import { enqueueSms } from '@/lib/queue/queues'
import { haversineDistanceKm } from '@/lib/geo/distance'

/**
 * Brief §3 "Pravidla pro vznik akcí" — a municipality picks one of three modes
 * (Municipalities.rulesForCreation). A signed-out visitor is always read-only regardless.
 */
const canCreateEvent: Access = async ({ req, data }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true
  if (!data?.municipality) return false

  const municipalityId = String(
    typeof data.municipality === 'object' ? data.municipality.id : data.municipality,
  )

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.includes(municipalityId)) return true

  const municipality = await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
  })
  const rule = municipality?.rulesForCreation ?? 'approved_organizers'

  if (rule === 'municipality_only') return false
  if (rule === 'anyone') return true

  const organizerIds = await getOrganizerMunicipalityIds(payload, user.id)
  return organizerIds.includes(municipalityId)
}

/** Brief §4 organizer self-service edit/cancel of their own event (cancelling is a PATCH that
 * sets deletedAt, see admin-queries.ts) — the organizer or a co-organizer, a municipality admin
 * for any event in their obec, and a platform admin everywhere. Moving an event to another obec
 * or handing it to another organizer stays platform-admin-only (field access below). */
const canUpdateEvent: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  const or: Where[] = [{ organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }]
  if (administeredIds.length > 0) or.push({ municipality: { in: administeredIds } })
  const where: Where = { or }
  return where
}

/** Platform/municipality admin everywhere they administer — a hard DELETE isn't part of the
 * organizer's self-service (cancelling is the soft-delete PATCH above). */
const canDeleteEvent: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length === 0) return false
  const where: Where = { municipality: { in: administeredIds } }
  return where
}

const platformAdminOnly = ({ req: { user } }: { req: { user: { role?: string } | null } }) => user?.role === 'admin'

/**
 * Brief §3 "Žádost organizátora o příznak Dobrovolnictví... schvaluje se odděleně od role
 * organizátora. Admin obce sám o příznak žádat nemusí, může ho u vlastní akce zaškrtnout
 * rovnou." Only a platform/municipality admin may flip this true directly; an organizer's
 * request instead goes through VolunteerFlagRequests, whose approval hook sets
 * `req.context.skipVolunteeringGuard` — the one trusted path allowed to flip it for a
 * non-admin, since that hook already ran its own approval check.
 */
const guardIsVolunteering: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data || data.isVolunteering !== true || originalDoc?.isVolunteering === true) return data
  if (req.context?.skipVolunteeringGuard) return data

  const { user, payload } = req
  if (user?.role === 'admin') return data

  const municipalityId = String(
    typeof data.municipality === 'object' ? data.municipality?.id : (data.municipality ?? originalDoc?.municipality),
  )
  const isMuniAdminHere = user
    ? (await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)
    : false

  if (!isMuniAdminHere) {
    data.isVolunteering = originalDoc?.isVolunteering ?? false
  }

  return data
}

/** A new event can't start in the past, and neither can one that gets rescheduled — but the
 * start is only checked when it actually changes, so editing e.g. the title of an event that is
 * already running (or over) keeps working. A multi-day event can't end before it starts. */
const validateEventDates: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (!data) return data

  const start = data.dateTime ?? originalDoc?.dateTime
  const end = data.endDateTime === undefined ? originalDoc?.endDateTime : data.endDateTime
  if (!start) return data

  const startMs = new Date(start).getTime()
  const startChanged =
    operation === 'create' || (originalDoc?.dateTime && startMs !== new Date(originalDoc.dateTime).getTime())

  if (startChanged && startMs < Date.now()) {
    throw new APIError('Akce nemůže začínat v minulosti. Vyberte prosím budoucí datum a čas.', 400)
  }
  if (end && new Date(end).getTime() < startMs) {
    throw new APIError('Konec akce nemůže být dřív než její začátek.', 400)
  }

  return data
}

/**
 * The location an event is created/edited at must actually be near the obec it's filed
 * under — otherwise an admin obce (or organizer) could plant an event anywhere and have it
 * show up on a completely unrelated municipality's page. Bounded by that municipality's own
 * configurable `eventRadiusKm` (Municipalities.ts) rather than a fixed constant, since a
 * small village and a big city need very different radii. Applies to every creator (admin,
 * organizer, or "anyone" mode alike) — this is a data-integrity check, not a role check.
 */
const validateEventLocationRadius: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data) return data

  const lat = data.lat ?? originalDoc?.lat
  const lng = data.lng ?? originalDoc?.lng
  const municipalityRaw = data.municipality ?? originalDoc?.municipality
  if (typeof lat !== 'number' || typeof lng !== 'number' || !municipalityRaw) return data

  const municipalityId = typeof municipalityRaw === 'object' ? municipalityRaw.id : municipalityRaw

  const municipality = await req.payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
  })
  if (!municipality) return data

  const radiusKm = municipality.eventRadiusKm ?? 15
  const distanceKm = haversineDistanceKm(lat, lng, municipality.lat, municipality.lng)

  if (distanceKm > radiusKm) {
    // status 400 (not the default 500) makes Payload treat this as a *public* error — a plain
    // `throw new Error()` here would otherwise get masked to a generic "Something went wrong"
    // over REST (see isErrorPublic.js), which would make this check impossible to act on from the UI.
    throw new APIError(
      `Místo konání je ${distanceKm.toFixed(1)} km od obce „${municipality.name}“, což přesahuje povolený okruh ${radiusKm} km. Vyberte místo blíž obci, nebo upravte okruh v nastavení obce.`,
      400,
    )
  }

  return data
}

/** Registered (pending/approved) participants for an event, excluding the organizer
 * themselves — shared by the cancellation and edit-notification hooks below. */
async function getRegistrantIdsToNotify(
  req: Parameters<CollectionAfterChangeHook>[0]['req'],
  eventId: number | string,
  organizerId: number | string,
): Promise<(number | string)[]> {
  const regs = await req.payload.find({
    collection: 'registrations',
    where: { and: [{ event: { equals: eventId } }, { status: { in: ['pending', 'approved'] } }] },
    depth: 0,
    limit: 1000,
    overrideAccess: true,
  })
  return regs.docs
    .map((reg) => (typeof reg.user === 'object' ? reg.user.id : reg.user))
    .filter((userId) => String(userId) !== String(organizerId))
}

/** Brief §8 "oznámení o změně/zrušení musí jít přes SMS/mail" — SMS to whichever of these
 * users have a phone on file (onboarding step, still optional until they've filled it in).
 * A no-op (not an error) when httpSMS isn't configured — enqueueSms/the worker log that. */
async function notifyPhonesForEvent(
  req: Parameters<CollectionAfterChangeHook>[0]['req'],
  userIds: (number | string)[],
  eventId: number | string,
  message: string,
): Promise<void> {
  if (userIds.length === 0) return
  const profiles = await req.payload.find({
    collection: 'profiles',
    where: { user: { in: userIds } },
    depth: 0,
    limit: userIds.length,
    overrideAccess: true,
  })
  await Promise.all(
    profiles.docs.map((p) => {
      const to = p.phone ? toE164(p.phone) : null
      if (!to) return undefined
      const userId = typeof p.user === 'object' ? p.user.id : p.user
      // Timestamped, not just event+user — httpSMS dedupes on request_id, and an event can
      // be edited (and so SMS'd about) more than once.
      return enqueueSms({ to, message, requestId: `event-${eventId}-${userId}-${Date.now()}` })
    }),
  )
}

/** httpSMS expects E.164, but onboarding accepts Czech numbers as typed ("735 929 442",
 * "+420 735…", "00420…"). A bare 9-digit number is Czech; anything unrecognisable is skipped. */
function toE164(phone: string): string | null {
  const compact = phone.replace(/[^\d+]/g, '').replace(/^00/, '+')
  if (/^\+\d{9,15}$/.test(compact)) return compact
  if (/^\d{9}$/.test(compact)) return `+420${compact}`
  return null
}

/** Cancelling an event (soft-delete via `deletedAt`) doesn't hard-delete the row — the FK
 * from existing registrations would block that anyway — so instead we notify everyone who
 * was pending/approved. The event itself already vanishes from their views on its own: it
 * fails Events' own `notDeleted` read-access check, so it simply won't populate when their
 * registrations are fetched (see getMyRegistrationsWithEvents / queries.ts). */
const notifyRegistrantsOnCancellation: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return doc
  if (previousDoc?.deletedAt || !doc.deletedAt) return doc

  try {
    const organizerId = typeof doc.organizer === 'object' ? doc.organizer.id : doc.organizer
    const userIds = await getRegistrantIdsToNotify(req, doc.id, organizerId)

    await Promise.all(
      userIds.map((userId) =>
        sendNotification(req.payload, {
          userId,
          title: 'Akce byla zrušena',
          message: `Akce „${doc.title}“, na kterou jste byli přihlášeni, byla pořadatelem zrušena.`,
          email: {
            subject: `Akce zrušena: ${doc.title}`,
            body: `<p>Akce <strong>${doc.title}</strong>, na kterou jste byli přihlášeni, byla pořadatelem zrušena.</p>`,
          },
        }),
      ),
    )
    await notifyPhonesForEvent(req, userIds, doc.id, `Lonvita: akce „${doc.title}“ byla zrušena.`)
    await cancelEventReminders(req.payload, doc.id)
  } catch (error) {
    req.payload.logger.error(`Failed to notify registrants of cancelled event ${doc.id}: ${error}`)
  }

  return doc
}

/** Brief §7 "Úprava existující akce → všichni přihlášení účastníci" — every field a participant
 * can see on the event, with the (Czech) label used to tell them what changed. Routine internal
 * writes (e.g. the isVolunteering guard, a photo swap) don't notify anyone. */
const NOTIFIABLE_EDIT_FIELDS: Record<string, string> = {
  title: 'název',
  dateTime: 'začátek',
  endDateTime: 'konec',
  recurrenceRule: 'opakování',
  locationText: 'místo konání',
  lat: 'místo konání',
  lng: 'místo konání',
  description: 'popis',
  capacity: 'kapacita',
  registrationApprovalMode: 'způsob přihlašování',
  accessibilityTags: 'přístupnost',
  organization: 'pořadatel',
  categories: 'kategorie',
  isPaid: 'cena',
  priceCents: 'cena',
}

const DATE_FIELDS = new Set(['dateTime', 'endDateTime'])

/** Comparable form of a field value — relationship ids instead of populated docs, sorted
 * arrays, and timestamps for dates (the same instant can come back formatted differently). */
function comparable(field: string, value: unknown): string {
  const idOf = (v: unknown) => (v && typeof v === 'object' && 'id' in v ? (v as { id: unknown }).id : v)
  if (value === undefined || value === null || value === '') return 'null'
  if (DATE_FIELDS.has(field)) return String(new Date(value as string).getTime())
  if (Array.isArray(value)) return JSON.stringify(value.map(idOf).map(String).sort())
  return JSON.stringify(idOf(value))
}

const formatPragueDateTime = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Brief §8 / notes "pokud se změní lokalita, čas cokoliv jiného, odešle se automaticky mail na
 * všechny přihlášené a na telefonní čísla SMS, a samozřejmě upozornění do aplikace". */
const notifyRegistrantsOnEdit: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !previousDoc) return doc
  if (doc.deletedAt) return doc // the cancellation hook already covers this transition

  const changedFields = Object.keys(NOTIFIABLE_EDIT_FIELDS).filter(
    (field) => comparable(field, doc[field]) !== comparable(field, previousDoc[field]),
  )
  if (changedFields.length === 0) return doc

  try {
    if (changedFields.includes('dateTime') || changedFields.includes('endDateTime')) {
      await rescheduleEventReminders(req.payload, doc as Parameters<typeof rescheduleEventReminders>[1])
    }

    const organizerId = typeof doc.organizer === 'object' ? doc.organizer.id : doc.organizer
    const userIds = await getRegistrantIdsToNotify(req, doc.id, organizerId)
    if (userIds.length === 0) return doc

    const changedLabels = Array.from(new Set(changedFields.map((field) => NOTIFIABLE_EDIT_FIELDS[field])))
    const when = formatPragueDateTime(doc.dateTime)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const title = escapeHtml(doc.title)

    await Promise.all(
      userIds.map((userId) =>
        sendNotification(req.payload, {
          userId,
          title: 'Akce byla upravena',
          message: `Akce „${doc.title}“, na kterou jste přihlášeni, byla upravena (změna: ${changedLabels.join(', ')}). Nově: ${when}, ${doc.locationText}.`,
          link: `/akce/${doc.id}`,
          email: {
            subject: `Akce upravena: ${doc.title}`,
            body:
              `<p>Akce <strong>${title}</strong>, na kterou jste přihlášeni, byla upravena.</p>` +
              `<p>Změna: ${changedLabels.join(', ')}</p>` +
              `<p><strong>Kdy:</strong> ${when}<br/><strong>Kde:</strong> ${escapeHtml(doc.locationText)}</p>` +
              `<p><a href="${appUrl}/akce/${doc.id}">Zobrazit detail akce</a></p>`,
          },
        }),
      ),
    )
    const place = doc.locationText.length > 60 ? `${doc.locationText.slice(0, 57)}…` : doc.locationText
    await notifyPhonesForEvent(
      req,
      userIds,
      doc.id,
      `Lonvita: akce „${doc.title}“ byla upravena (${changedLabels.join(', ')}). Nově: ${when}, ${place}.`,
    )
  } catch (error) {
    req.payload.logger.error(`Failed to notify registrants of edited event ${doc.id}: ${error}`)
  }

  return doc
}

/** Scheduled once at creation time; moved along with the event if it's later rescheduled. */
const scheduleAttendanceReminderOnCreate: CollectionAfterChangeHook = async ({ doc, operation, req, context }) => {
  // Seeded demo events (src/lib/seed/run.ts) don't queue organizer reminders.
  if (operation !== 'create' || context?.skipNotifications) return doc

  try {
    await scheduleAttendanceReminder(req.payload, doc as Parameters<typeof scheduleAttendanceReminder>[1])
  } catch (error) {
    req.payload.logger.error(`Failed to schedule attendance reminder for event ${doc.id}: ${error}`)
  }

  return doc
}

export const Events: CollectionConfig = {
  slug: 'events',
  labels: {
    singular: 'Event',
    plural: 'Events',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'municipality', 'dateTime', 'capacity', 'updatedAt'],
  },
  access: {
    // Public marketplace listing — open to signed-out visitors too (brief §2 "Nepřihlášený
    // návštěvník má mít možnost prohlédnout si přehled akcí v obci"). The frontend filters by
    // municipality itself (matches the existing Index.tsx query pattern: .eq('municipality_id', muniId)).
    read: () => notDeleted,
    // Brief §3 "Pravidla pro vznik akcí" — gated per-municipality instead of any logged-in user.
    create: canCreateEvent,
    update: canUpdateEvent,
    delete: canDeleteEvent,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      access: { update: platformAdminOnly },
    },
    {
      name: 'dateTime',
      type: 'date',
      required: true,
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'endDateTime',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        description:
          'Brief §4 "Datum jako rozsah" — an event can span more than one day. Leave empty for a single-day event.',
      },
    },
    {
      name: 'recurrenceRule',
      type: 'text',
      admin: {
        description:
          'Brief §4 "Opakující se série" (e.g. "weekly:tuesday") — a simple machine-readable rule set on the first occurrence only. Combines with endDateTime for a multi-day recurring series. Occurrence generation is a separate, later piece; this field just records the intent.',
      },
    },
    {
      name: 'recurrenceParent',
      type: 'relationship',
      relationTo: 'events',
      admin: {
        description: 'Set on a generated occurrence, pointing back at the event that defines recurrenceRule.',
        position: 'sidebar',
      },
    },
    {
      name: 'locationText',
      type: 'text',
      required: true,
      admin: {
        description: 'Human-readable label for the picked location (from the map picker\'s search result, editable).',
      },
    },
    {
      name: 'lat',
      type: 'number',
      required: true,
      admin: {
        description: 'Brief §12 "ROZHODNĚ NE NAPSAT LOKACI" — set via the map picker, never typed freehand.',
      },
    },
    {
      name: 'lng',
      type: 'number',
      required: true,
    },
    {
      name: 'accessibilityTags',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Bezbariérový přístup', value: 'wheelchair_access' },
        { label: 'Indukční smyčka', value: 'induction_loop' },
        { label: 'Možnost sezení', value: 'seating' },
        { label: 'WC pro invalidy', value: 'accessible_wc' },
      ],
      admin: {
        description:
          'Brief §4/§6 "Tag přístupnosti místa konání" — set by the organizer, shown to participants on the event.',
      },
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'registrationApprovalMode',
      type: 'select',
      required: true,
      defaultValue: 'manual',
      options: [
        { label: 'Bez schvalování', value: 'auto' },
        { label: 'S potvrzením organizátora', value: 'manual' },
      ],
      admin: {
        description:
          'Brief §4 "Přihlašování účastníků" — chosen per event by the organizer. "auto" also gates the server-side capacity check on Registrations.',
      },
    },
    {
      name: 'organizer',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: { update: platformAdminOnly },
      admin: {
        description: 'The user organizing this event. Additional organizers: see coOrganizers below.',
      },
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      admin: {
        description:
          'Brief §4 "Organizace" — which of the organizer\'s organizations this event is published under. Empty = published under their personal name.',
      },
    },
    {
      name: 'coOrganizers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      admin: {
        description:
          'Brief §4 "Spolupořadatelství" — additional organizers (e.g. two organizations running an event together). The event appears in each co-organizer\'s own dashboard/"moje akce" alongside the primary organizer.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Full', value: 'full' },
        { label: 'Finished', value: 'finished' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'event-categories',
      hasMany: true,
      required: true,
      admin: {
        description:
          'Brief §2 "Jedna akce může mít víc kategorií zároveň" — one or more categories. Filtering by a category matches any event that has it among its categories.',
      },
    },
    {
      name: 'image',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        description: 'Cover image shown in event listings.',
      },
    },
    {
      name: 'isVolunteering',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Tagged by the organizer at creation — feeds the Datavita "share of volunteers" metric.',
      },
    },
    {
      name: 'isPaid',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'priceCents',
      type: 'number',
      min: 0,
      admin: {
        description:
          'Price in the smallest currency unit (e.g. haléře). Informational only — the app does not process payment; the organizer handles it outside the app (brief §4).',
        condition: (data) => Boolean(data?.isPaid),
      },
    },
    {
      name: 'cancellationPolicy',
      type: 'select',
      required: true,
      defaultValue: 'cancel_48h',
      options: [
        { label: 'No cancellation', value: 'none' },
        { label: 'Up to 24h before', value: 'cancel_24h' },
        { label: 'Up to 48h before', value: 'cancel_48h' },
        { label: 'Up to 7 days before', value: 'cancel_7d' },
      ],
    },
    {
      name: 'deletedAt',
      type: 'date',
      admin: {
        description: 'Soft-delete marker — preserves attendance history when an event is removed.',
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeChange: [validateEventDates, validateEventLocationRadius, guardIsVolunteering],
    afterChange: [notifyRegistrantsOnCancellation, notifyRegistrantsOnEdit, scheduleAttendanceReminderOnCreate],
  },
  timestamps: true,
}
