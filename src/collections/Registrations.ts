import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { enqueueEmail } from '@/lib/queue/queues'
import { publishCapacityChange } from '@/lib/realtime/eventCapacity'
import { sendNotification } from './shared/notify'

import { isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared'
import { deletedAtField, notDeleted } from './shared/softDelete'

const REGISTRATION_STATUS_SUBJECT: Record<string, string> = {
  approved: 'Vaše přihláška byla schválena',
  rejected: 'Vaše přihláška byla zamítnuta',
}

/** Brief §8 live "Přihlásit se"/"Akce je plná" button — publish the event's new approved
 * count whenever a change could have added or removed someone from that count (a fresh
 * approval, or an existing approved registration being cancelled/rejected). Any other status
 * transition (pending -> rejected, cancelled -> pending, etc.) never touched the approved
 * count, so skip the publish rather than send a no-op update to every open detail page. */
const broadcastCapacityChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const wasApproved = previousDoc?.status === 'approved'
  const isApproved = doc.status === 'approved'
  // On create there's no previousDoc, so only a create that lands straight in "approved"
  // (organizer-registers-own-event, or auto-approval mode) can have changed the count.
  const mayHaveChanged = operation === 'create' ? isApproved : wasApproved !== isApproved
  if (!mayHaveChanged) return doc

  const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event
  try {
    // Passing `req` matters: this write is still inside the current request's DB
    // transaction, so a count query on a fresh connection (no `req`) would run against the
    // pre-write snapshot and undercount the row that was just approved/unapproved.
    const result = await req.payload.count({
      collection: 'registrations',
      where: { and: [{ event: { equals: eventId } }, { status: { equals: 'approved' } }] },
      overrideAccess: true,
      req,
    })
    publishCapacityChange(eventId, result.totalDocs)
  } catch (error) {
    req.payload.logger.error(`Failed to broadcast capacity change for event ${eventId}: ${error}`)
  }
  return doc
}

const notifyOnRegistrationChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  try {
    const userId = typeof doc.user === 'object' ? doc.user.id : doc.user
    const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event
    const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    const organizerId = typeof event.organizer === 'object' ? event.organizer.id : event.organizer

    // Brief §7 "Přihlášení na akci → účastník" — confirmation on create, whatever status it
    // landed in (auto-approved, or pending an organizer's review).
    if (operation === 'create') {
      const isSelfOrganizing = String(organizerId) === String(userId)
      if (!isSelfOrganizing) {
        const pending = doc.status === 'pending'
        await sendNotification(req.payload, {
          userId,
          title: pending ? 'Přihláška odeslána' : 'Přihláška potvrzena',
          message: pending
            ? `Vaše přihláška na akci „${event.title}“ čeká na schválení organizátorem.`
            : `Jste přihlášeni na akci „${event.title}“.`,
          email: {
            subject: pending ? `Přihláška odeslána: ${event.title}` : `Přihláška potvrzena: ${event.title}`,
            body: pending
              ? `<p>Vaše přihláška na akci <strong>${event.title}</strong> čeká na schválení organizátorem.</p>`
              : `<p>Jste přihlášeni na akci <strong>${event.title}</strong>.</p>`,
          },
        })

        // Brief §7 "Nové přihlášení na akci → organizátor".
        await sendNotification(req.payload, {
          userId: organizerId,
          title: 'Nová přihláška na akci',
          message: `Někdo se přihlásil na vaši akci „${event.title}“.`,
          email: {
            subject: `Nová přihláška: ${event.title}`,
            body: `<p>Někdo se přihlásil na vaši akci <strong>${event.title}</strong>.</p>`,
          },
        })
      }
      return doc
    }

    if (operation !== 'update' || doc.status === previousDoc?.status) return doc
    if (!REGISTRATION_STATUS_SUBJECT[doc.status]) return doc

    const approved = doc.status === 'approved'
    await sendNotification(req.payload, {
      userId,
      title: REGISTRATION_STATUS_SUBJECT[doc.status],
      message: approved
        ? `Vaše přihláška na akci „${event.title}“ byla schválena.`
        : `Vaše přihláška na akci „${event.title}“ byla bohužel zamítnuta.`,
      email: {
        subject: `${REGISTRATION_STATUS_SUBJECT[doc.status]}: ${event.title}`,
        body: approved
          ? `<p>Vaše přihláška na akci <strong>${event.title}</strong> byla schválena.</p>`
          : `<p>Vaše přihláška na akci <strong>${event.title}</strong> byla bohužel zamítnuta.</p>`,
      },
    })

    // 24h reminder — scheduled once at approval time (brief §A5: "levné a užitečné"). Sent
    // via the raw email queue (not sendNotification) since it's timing-sensitive and should
    // go out regardless of the in-app preference; it still only fires for users who haven't
    // opted out of email entirely.
    if (approved) {
      const profiles = await req.payload.find({
        collection: 'profiles',
        where: { user: { equals: userId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      const profile = profiles.docs[0]
      const user = await req.payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })
      if (user?.email && (profile?.notifyEmail ?? true)) {
        const reminderAt = new Date(event.dateTime).getTime() - 24 * 60 * 60 * 1000
        const delay = reminderAt - Date.now()
        if (delay > 0) {
          await enqueueEmail(
            {
              to: user.email,
              subject: `Připomínka: ${event.title} zítra`,
              body: `<p>Připomínáme, že zítra vás čeká akce <strong>${event.title}</strong> — ${event.locationText}.</p>`,
            },
            { jobId: `reminder-${doc.id}`, delay },
          )
        }
      }
    }
  } catch (error) {
    req.payload.logger.error(`Failed to notify on registration change: ${error}`)
  }

  return doc
}

export const Registrations: CollectionConfig = {
  slug: 'registrations',
  labels: {
    singular: 'Registration',
    plural: 'Registrations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['event', 'user', 'status', 'attendanceStatus', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => (user ? notDeleted : false),
    create: isLoggedIn,
    update: isLoggedIn,
    // Platform superadmin everywhere, or a municipality admin scoped to their own
    // municipality (traverses the relationship: registration -> event -> municipality).
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
      name: 'user',
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
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        description: '"Smí přijít" — whether the registration itself is allowed, not whether they attended.',
      },
    },
    {
      name: 'attendanceStatus',
      type: 'select',
      defaultValue: 'not_marked',
      options: [
        { label: 'Not marked', value: 'not_marked' },
        { label: 'Attended', value: 'attended' },
        { label: 'No-show', value: 'no_show' },
        { label: 'Excused', value: 'excused' },
      ],
      admin: {
        description: 'What actually happened — set by the organizer after the event, on the manage-event page.',
      },
    },
    {
      name: 'attendanceMarkedAt',
      type: 'date',
      admin: { position: 'sidebar' },
    },
    {
      name: 'attendanceMarkedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'The organizer who marked attendance.',
        position: 'sidebar',
      },
    },
    {
      name: 'attendanceNote',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    deletedAtField,
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.event || !data?.user) return data

        if (operation === 'update' && originalDoc?.event === data.event && originalDoc?.user === data.user) {
          return data
        }

        // A cancelled registration doesn't block re-registering — both rows stay in
        // history (cancel + re-register), which matches append-only event tracking (brief §A2)
        // better than the old hard-delete-and-recreate flow did.
        const existing = await req.payload.find({
          collection: 'registrations',
          where: {
            and: [
              { event: { equals: data.event } },
              { user: { equals: data.user } },
              { status: { not_equals: 'cancelled' } },
            ],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error('This user is already registered for this event.')
        }

        if (operation === 'create') {
          const event = await req.payload.findByID({
            collection: 'events',
            id: data.event,
            depth: 0,
            overrideAccess: true,
          })
          const organizerId = typeof event.organizer === 'object' ? event.organizer.id : event.organizer

          // An organizer registering for their own event doesn't make sense to leave
          // "pending" — they'd be the one who has to approve it. Auto-approve instead.
          if (String(organizerId) === String(data.user)) {
            data.status = 'approved'
          } else if (event.registrationApprovalMode === 'auto') {
            // Brief §4/§8 — "auto" registers everyone immediately, so the capacity check has
            // to happen server-side here, not just as a disabled button on the frontend (that
            // read can be stale). What happens to a signup that arrives once it's already full
            // under "auto" (waitlist vs. hard reject) is still an open question (brief §8) —
            // for now it's a hard reject, the simplest safe behavior.
            const activeCount = await req.payload.count({
              collection: 'registrations',
              where: {
                and: [{ event: { equals: data.event } }, { status: { in: ['pending', 'approved'] } }],
              },
              overrideAccess: true,
            })
            if (activeCount.totalDocs >= event.capacity) {
              throw new Error('This event is already at full capacity.')
            }
            data.status = 'approved'
          }
        }

        return data
      },
    ],
    afterChange: [notifyOnRegistrationChange, broadcastCapacityChange],
  },
  timestamps: true,
}
