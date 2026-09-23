import type { Access, CollectionAfterChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canReadOwnOrAdministered, isPlatformOrMunicipalityAdmin } from './access/shared'
import { escapeHtml, getMunicipalityAdminUserIds, sendNotification } from './shared/notify'
import { writeAuditLog } from './shared/auditLog'
import { ORGANIZER_REASON_MAX_LENGTH, ORGANIZER_REASON_MIN_LENGTH } from '@/lib/validation'
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
  isOrganizationType,
} from '@/lib/organizations'

const canCreateOwnRequest: Access = ({ req: { user }, data }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  return String(data?.user) === String(user.id)
}

const notifyOnRequestChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const userId = typeof doc.user === 'object' ? doc.user.id : doc.user
  const municipalityId = typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality

  if (operation === 'create') {
    const adminIds = await getMunicipalityAdminUserIds(req.payload, municipalityId)
    const profile = await req.payload.find({
      collection: 'profiles',
      where: { user: { equals: userId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    const who = profile.docs[0]?.fullName || 'Někdo v obci'
    const reason = doc.reason ?? ''
    for (const adminId of adminIds) {
      sendNotification(req.payload, {
        userId: adminId,
        title: 'Nová žádost o roli organizátora',
        link: '/admin-obce',
        message: `${who} žádá o roli organizátora za „${doc.organizationName}“: „${reason}“ — vyřiďte to v sekci Žádosti.`,
        email: {
          subject: 'Nová žádost o roli organizátora',
          body:
            `<p><strong>${escapeHtml(who)}</strong> ve vaší obci požádal(a) o roli organizátora za <strong>${escapeHtml(doc.organizationName ?? '')}</strong>.</p>` +
            `<p><strong>Zdůvodnění:</strong><br/>${escapeHtml(reason).replace(/\n/g, '<br/>')}</p>` +
            '<p>Schválit nebo zamítnout ji můžete v sekci Žádosti v adminu obce.</p>',
        },
      })
    }
    return
  }

  if (operation === 'update' && doc.status !== previousDoc?.status) {
    if (doc.status === 'approved') {
      // The one trusted path allowed to grant the role — beforeChange below still runs
      // UserRoles' own uniqueness hook, so approving twice can't double-grant.
      try {
        await req.payload.create({
          collection: 'user-roles',
          data: { user: userId, municipality: municipalityId, role: 'organizer' },
          overrideAccess: true,
          // UserRoles creates the organization the obec just approved along with the role.
          context: { organization: { name: doc.organizationName, type: doc.organizationType } },
        })
      } catch (error) {
        req.payload.logger.error(`Failed to grant organizer role after request ${doc.id} approval: ${error}`)
      }
      sendNotification(req.payload, {
        userId,
        title: 'Role organizátora schválena',
        link: '/vytvorit',
        message: 'Vaše žádost o roli organizátora byla schválena.',
        email: {
          subject: 'Role organizátora schválena',
          body: '<p>Vaše žádost o roli organizátora byla schválena. Teď můžete v aplikaci zakládat vlastní akce.</p>',
        },
      })
      writeAuditLog(req.payload, {
        action: 'organizer-requests.approve',
        actor: req.user?.id ?? null,
        targetCollection: 'organizer-requests',
        targetId: doc.id,
        municipality: municipalityId,
        metadata: { requestedBy: userId },
      })
    } else if (doc.status === 'rejected') {
      sendNotification(req.payload, {
        userId,
        title: 'Žádost o roli organizátora zamítnuta',
        link: '/profil',
        message: 'Vaše žádost o roli organizátora byla zamítnuta.',
        email: {
          subject: 'Žádost o roli organizátora zamítnuta',
          body: '<p>Vaše žádost o roli organizátora byla bohužel zamítnuta.</p>',
        },
      })
      writeAuditLog(req.payload, {
        action: 'organizer-requests.reject',
        actor: req.user?.id ?? null,
        targetCollection: 'organizer-requests',
        targetId: doc.id,
        municipality: municipalityId,
        metadata: { requestedBy: userId },
      })
    }
  }
}

export const OrganizerRequests: CollectionConfig = {
  slug: 'organizer-requests',
  labels: {
    singular: 'Organizer Request',
    plural: 'Organizer Requests',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'municipality', 'status', 'updatedAt'],
  },
  access: {
    read: canReadOwnOrAdministered('user'),
    create: canCreateOwnRequest,
    update: isPlatformOrMunicipalityAdmin(),
    delete: isPlatformOrMunicipalityAdmin(),
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
    },
    {
      // Not `required` at the DB level — requests filed before this field existed have none.
      // A new request must carry one (checked in beforeValidate below).
      name: 'reason',
      type: 'textarea',
      maxLength: ORGANIZER_REASON_MAX_LENGTH,
      access: { update: () => false },
      admin: {
        description:
          'Why the applicant wants to organize events here (e.g. they run a business in town) — what the obec admin decides on.',
      },
    },
    {
      // Who the applicant will organize as — a café, a club, or just themselves ("individual").
      // Becomes their Organizations row on approval. Not `required` at the DB level for the same
      // reason as `reason` above; a new request must carry both (beforeValidate below).
      name: 'organizationName',
      type: 'text',
      maxLength: ORGANIZATION_NAME_MAX_LENGTH,
      access: { update: () => false },
    },
    {
      name: 'organizationType',
      type: 'select',
      options: ORGANIZATION_TYPES.map((t) => ({ label: t.label, value: t.value })),
      access: { update: () => false },
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
      ],
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
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.user || !data?.municipality) return data
        if (operation !== 'create') return data

        const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
        if (reason.length < ORGANIZER_REASON_MIN_LENGTH) {
          throw new APIError(
            `Napište prosím obci aspoň pár slov (min. ${ORGANIZER_REASON_MIN_LENGTH} znaků), proč chcete pořádat akce — třeba že ve městě provozujete podnik nebo vedete spolek.`,
            400,
          )
        }
        data.reason = reason

        const organizationName = typeof data.organizationName === 'string' ? data.organizationName.trim() : ''
        if (organizationName.length < ORGANIZATION_NAME_MIN_LENGTH) {
          throw new APIError(
            'Vyplňte, za koho budete akce pořádat — název podniku nebo spolku, případně vaše jméno či název vaší aktivity.',
            400,
          )
        }
        if (!isOrganizationType(data.organizationType)) {
          throw new APIError('Vyberte, jestli jste podnik, spolek, nebo jednotlivec.', 400)
        }
        data.organizationName = organizationName

        const existing = await req.payload.find({
          collection: 'organizer-requests',
          where: {
            and: [
              { user: { equals: data.user } },
              { municipality: { equals: data.municipality } },
              { status: { equals: 'pending' } },
            ],
          },
          limit: 1,
          overrideAccess: true,
        })
        if (existing.docs.length > 0) {
          throw new Error('You already have a pending organizer request for this municipality.')
        }

        const existingRole = await req.payload.find({
          collection: 'user-roles',
          where: {
            and: [
              { user: { equals: data.user } },
              { municipality: { equals: data.municipality } },
              { role: { equals: 'organizer' } },
            ],
          },
          limit: 1,
          overrideAccess: true,
        })
        if (existingRole.docs.length > 0) {
          throw new Error('You are already an organizer in this municipality.')
        }

        return data
      },
      // Stamp reviewedBy/reviewedAt whenever status is set on update (approve/reject).
      ({ data, req, operation, originalDoc }) => {
        if (operation !== 'update' || !data) return data
        if (data.status && data.status !== originalDoc?.status) {
          data.reviewedBy = req.user?.id
          data.reviewedAt = new Date().toISOString()
        }
        return data
      },
    ],
    afterChange: [notifyOnRequestChange],
  },
  timestamps: true,
}
