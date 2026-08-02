import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { enqueueEmail } from '@/lib/queue/queues'

import { isLoggedIn } from './access/shared'

const REGISTRATION_STATUS_SUBJECT: Record<string, string> = {
  approved: 'Vaše přihláška byla schválena',
  declined: 'Vaše přihláška byla zamítnuta',
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
    const profileId = typeof doc.profile === 'object' ? doc.profile.id : doc.profile
    const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event

    const [profile, event] = await Promise.all([
      req.payload.findByID({ collection: 'profiles', id: profileId, depth: 1, overrideAccess: true }),
      req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }),
    ])

    const user = typeof profile.user === 'object' ? profile.user : null
    if (!user?.email) return doc

    const approved = doc.status === 'approved'
    await enqueueEmail({
      to: user.email,
      subject: `${REGISTRATION_STATUS_SUBJECT[doc.status]}: ${event.title}`,
      body: approved
        ? `<p>Dobrý den ${profile.fullName},</p><p>vaše přihláška na akci <strong>${event.title}</strong> byla schválena.</p>`
        : `<p>Dobrý den ${profile.fullName},</p><p>vaše přihláška na akci <strong>${event.title}</strong> byla bohužel zamítnuta.</p>`,
    })
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
    defaultColumns: ['event', 'profile', 'status', 'attendanceStatus', 'updatedAt'],
  },
  access: {
    read: isLoggedIn,
    create: isLoggedIn,
    update: isLoggedIn,
    delete: isLoggedIn,
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
    },
    {
      name: 'profile',
      type: 'relationship',
      relationTo: 'profiles',
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
        { label: 'Declined', value: 'declined' },
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
      ],
      admin: {
        description: 'What actually happened — set by the organizer after the event.',
      },
    },
    {
      name: 'attendanceMarkedBy',
      type: 'relationship',
      relationTo: 'profiles',
      admin: {
        description: 'The organizer profile that marked attendance.',
      },
    },
    {
      name: 'paymentStatus',
      type: 'select',
      defaultValue: 'not_required',
      options: [
        { label: 'Not required', value: 'not_required' },
        { label: 'Pending', value: 'pending' },
        { label: 'Paid', value: 'paid' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    {
      name: 'deletedAt',
      type: 'date',
      admin: {
        description: 'Soft-delete marker — preserves attendance history.',
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    afterChange: [sendStatusChangeEmail],
  },
  timestamps: true,
}
