import type { Access, CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import {
  getAdministeredMunicipalityIds,
  getOrganizerMunicipalityIds,
  isPlatformOrMunicipalityAdmin,
} from './access/shared'
import { notDeleted } from './shared/softDelete'
import { sendNotification } from './shared/notify'
import { enqueueEmail, enqueueSms } from '@/lib/queue/queues'
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
    profiles.docs
      .filter((p) => p.phone)
      .map((p) => {
        const userId = typeof p.user === 'object' ? p.user.id : p.user
        // Timestamped, not just event+user — httpSMS dedupes on request_id, and an event can
        // be edited (and so SMS'd about) more than once.
        return enqueueSms({ to: p.phone!, message, requestId: `event-${eventId}-${userId}-${Date.now()}` })
      }),
  )
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
  } catch (error) {
    req.payload.logger.error(`Failed to notify registrants of cancelled event ${doc.id}: ${error}`)
  }

  return doc
}

/** Brief §7 "Úprava existující akce → všichni přihlášení účastníci". Fires on any update
 * that (a) isn't the cancellation itself (that has its own message above) and (b) actually
 * changed something a participant would care about, so routine internal writes (e.g. the
 * isVolunteering guard flipping a field back) don't spam everyone. */
const NOTIFIABLE_EDIT_FIELDS = ['title', 'dateTime', 'endDateTime', 'locationText', 'description'] as const

const notifyRegistrantsOnEdit: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !previousDoc) return doc
  if (doc.deletedAt) return doc // the cancellation hook already covers this transition

  const changed = NOTIFIABLE_EDIT_FIELDS.some((field) => doc[field] !== previousDoc[field])
  if (!changed) return doc

  try {
    const organizerId = typeof doc.organizer === 'object' ? doc.organizer.id : doc.organizer
    const userIds = await getRegistrantIdsToNotify(req, doc.id, organizerId)

    await Promise.all(
      userIds.map((userId) =>
        sendNotification(req.payload, {
          userId,
          title: 'Akce byla upravena',
          message: `Akce „${doc.title}“, na kterou jste přihlášeni, byla upravena — zkontrolujte prosím detail.`,
          email: {
            subject: `Akce upravena: ${doc.title}`,
            body: `<p>Akce <strong>${doc.title}</strong>, na kterou jste přihlášeni, byla upravena — zkontrolujte prosím detail akce v aplikaci.</p>`,
          },
        }),
      ),
    )
    await notifyPhonesForEvent(req, userIds, doc.id, `Lonvita: akce „${doc.title}“ byla upravena, zkontrolujte prosím detail.`)
  } catch (error) {
    req.payload.logger.error(`Failed to notify registrants of edited event ${doc.id}: ${error}`)
  }

  return doc
}

/** Brief §4/§7 "Po skončení akce organizátorovi přijde upozornění, že má vyplnit docházku."
 * Scheduled once at creation time, the same way as the pre-event 24h reminder — a delayed,
 * email-only job (no in-app/preference check, matching that reminder's own documented
 * simplification: this is a "did you remember to do X" nudge, not a live state query, and
 * the worker deliberately doesn't have Payload access to re-check attendance at fire time). */
const scheduleAttendanceReminder: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc

  try {
    const organizerId = typeof doc.organizer === 'object' ? doc.organizer.id : doc.organizer
    const organizer = await req.payload.findByID({
      collection: 'users',
      id: organizerId,
      depth: 0,
      overrideAccess: true,
    })
    if (!organizer?.email) return doc

    const endsAt = new Date(doc.endDateTime ?? doc.dateTime).getTime()
    // A few hours' buffer after the event's own end time, so this doesn't land while it's
    // plausibly still running.
    const remindAt = endsAt + 3 * 60 * 60 * 1000
    const delay = remindAt - Date.now()
    if (delay <= 0) return doc

    await enqueueEmail(
      {
        to: organizer.email,
        subject: `Nezapomeňte vyplnit docházku: ${doc.title}`,
        body: `<p>Akce <strong>${doc.title}</strong> proběhla — nezapomeňte prosím ve správě akce vyplnit docházku přihlášených.</p>`,
      },
      { jobId: `attendance-reminder-${doc.id}`, delay },
    )
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
    // Scoped the same as delete — cancelling an event is now a PATCH (sets deletedAt)
    // rather than a real DELETE (see admin-queries.ts), so update must be gated at least
    // as tightly as delete, not left open to any logged-in user. Organizer self-service
    // edit/cancel of their own event is deferred to the edit-event feature (brief §4).
    update: isPlatformOrMunicipalityAdmin('municipality'),
    // Platform superadmin everywhere, or a municipality admin scoped to their own municipality.
    delete: isPlatformOrMunicipalityAdmin('municipality'),
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
    beforeChange: [validateEventLocationRadius, guardIsVolunteering],
    afterChange: [notifyRegistrantsOnCancellation, notifyRegistrantsOnEdit, scheduleAttendanceReminder],
  },
  timestamps: true,
}
