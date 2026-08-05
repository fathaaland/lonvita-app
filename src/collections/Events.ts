import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'
import { notDeleted } from './shared/softDelete'

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
    const regs = await req.payload.find({
      collection: 'registrations',
      where: {
        and: [{ event: { equals: doc.id } }, { status: { in: ['pending', 'approved'] } }],
      },
      depth: 0,
      limit: 1000,
      overrideAccess: true,
    })

    const organizerId = typeof doc.organizer === 'object' ? doc.organizer.id : doc.organizer

    const toNotify = regs.docs.filter((reg) => {
      const regUserId = typeof reg.user === 'object' ? reg.user.id : reg.user
      // The organizer cancelled it themselves — no need to tell them what they just did.
      return String(regUserId) !== String(organizerId)
    })

    await Promise.all(
      toNotify.map((reg) =>
        req.payload.create({
          collection: 'notifications',
          data: {
            user: typeof reg.user === 'object' ? reg.user.id : reg.user,
            title: 'Akce byla zrušena',
            message: `Akce „${doc.title}“, na kterou jste byli přihlášeni, byla pořadatelem zrušena.`,
          },
          overrideAccess: true,
        }),
      ),
    )
  } catch (error) {
    req.payload.logger.error(`Failed to notify registrants of cancelled event ${doc.id}: ${error}`)
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
    // Public marketplace listing — the frontend filters by municipality itself
    // (matches the existing Index.tsx query pattern: .eq('municipality_id', muniId)).
    read: () => notDeleted,
    create: isLoggedIn,
    // Scoped the same as delete — cancelling an event is now a PATCH (sets deletedAt)
    // rather than a real DELETE (see admin-queries.ts), so update must be gated at least
    // as tightly as delete, not left open to any logged-in user.
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
      name: 'locationText',
      type: 'text',
      required: true,
    },
    {
      name: 'lat',
      type: 'number',
    },
    {
      name: 'lng',
      type: 'number',
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'organizer',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'The user organizing this event.',
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
      name: 'category',
      type: 'relationship',
      relationTo: 'event-categories',
      required: true,
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
        description: 'Price in the smallest currency unit (e.g. haléře), used with Stripe.',
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
    afterChange: [notifyRegistrantsOnCancellation],
  },
  timestamps: true,
}
