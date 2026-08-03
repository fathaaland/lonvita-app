import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { enqueueEmail } from '@/lib/queue/queues'

import { isLoggedIn } from './access/shared'
import { deletedAtField, adminOnlyDelete, notDeleted } from './shared/softDelete'

const REGISTRATION_STATUS_SUBJECT: Record<string, string> = {
  approved: 'Vaše přihláška byla schválena',
  rejected: 'Vaše přihláška byla zamítnuta',
}

const sendStatusChangeEmail: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update' || doc.status === previousDoc?.status) return doc
  if (!REGISTRATION_STATUS_SUBJECT[doc.status]) return doc

  try {
    const userId = typeof doc.user === 'object' ? doc.user.id : doc.user
    const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event

    const [profiles, user, event] = await Promise.all([
      req.payload.find({
        collection: 'profiles',
        where: { user: { equals: userId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      }),
      req.payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true }),
      req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }),
    ])

    if (!user?.email) return doc
    const fullName = profiles.docs[0]?.fullName ?? 'účastníku'

    const approved = doc.status === 'approved'
    await enqueueEmail({
      to: user.email,
      subject: `${REGISTRATION_STATUS_SUBJECT[doc.status]}: ${event.title}`,
      body: approved
        ? `<p>Dobrý den ${fullName},</p><p>vaše přihláška na akci <strong>${event.title}</strong> byla schválena.</p>`
        : `<p>Dobrý den ${fullName},</p><p>vaše přihláška na akci <strong>${event.title}</strong> byla bohužel zamítnuta.</p>`,
    })

    // 24h reminder — scheduled once at approval time (brief §A5: "levné a užitečné").
    // Known simplification: if the registration is later cancelled/rejected or the event
    // moves, the reminder still fires as originally scheduled — a dedicated notifications
    // table to track/cancel it isn't warranted yet at pilot scale (see ERD §4 on reminders).
    if (approved) {
      const reminderAt = new Date(event.dateTime).getTime() - 24 * 60 * 60 * 1000
      const delay = reminderAt - Date.now()
      if (delay > 0) {
        await enqueueEmail(
          {
            to: user.email,
            subject: `Připomínka: ${event.title} zítra`,
            body: `<p>Dobrý den ${fullName},</p><p>připomínáme, že zítra vás čeká akce <strong>${event.title}</strong> — ${event.locationText}.</p>`,
          },
          { jobId: `reminder-${doc.id}`, delay },
        )
      }
    }
  } catch (error) {
    req.payload.logger.error(`Failed to enqueue registration status email: ${error}`)
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
    defaultColumns: ['event', 'user', 'status', 'paymentStatus', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => (user ? notDeleted : false),
    create: isLoggedIn,
    update: isLoggedIn,
    delete: adminOnlyDelete,
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
        { label: 'Pending payment', value: 'pending_payment' },
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
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      defaultValue: 'none',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Paid', value: 'paid' },
        { label: 'Refunded', value: 'refunded' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'stripeSessionId',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    {
      name: 'stripePaymentIntentId',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    {
      name: 'amountPaidCents',
      type: 'number',
      admin: { position: 'sidebar' },
    },
    {
      name: 'refundedAt',
      type: 'date',
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

        return data
      },
    ],
    afterChange: [sendStatusChangeEmail],
  },
  timestamps: true,
}
