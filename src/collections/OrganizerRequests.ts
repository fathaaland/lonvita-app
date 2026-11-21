import type { Access, CollectionAfterChangeHook, CollectionConfig, FieldAccess, PayloadRequest, Where } from 'payload'
import { APIError } from 'payload'

import { canReadOwnOrAdministered, isPlatformOrMunicipalityAdmin } from './access/shared'
import { escapeHtml, getObecDeciders, sendNotification } from './shared/notify'
import { writeAuditLog } from './shared/auditLog'
import { ORGANIZER_REASON_MAX_LENGTH, ORGANIZER_REASON_MIN_LENGTH } from '@/lib/validation'
import { relationId } from '@/lib/relations'
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
  isOrganizationType,
} from '@/lib/organizations'
import { guardReadOnlyObec } from './shared/readOnlyObec'
import { ORGANIZER_ROLE_KIND, VOLUNTEER_ACCESS_KIND } from '@/lib/organizer-request-kinds'

const canCreateOwnRequest: Access = ({ req: { user }, data }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  return String(data?.user) === String(user.id)
}

const platformAdminField: FieldAccess = ({ req: { user } }) => user?.role === 'admin'

const notifyOnRequestChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const userId = typeof doc.user === 'object' ? doc.user.id : doc.user
  const municipalityId = typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality

  const accessOnly = doc.kind === VOLUNTEER_ACCESS_KIND

  if (operation === 'create') {
    const { userIds: adminIds, requestsLink } = await getObecDeciders(req.payload, municipalityId)
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
    if (accessOnly) {
      for (const adminId of adminIds) {
        sendNotification(req.payload, {
          userId: adminId,
          title: 'Žádost o přístup k dobrovolníkům',
          link: requestsLink,
          message: `Organizátor ${who} žádá o přístup k poolu dobrovolníků${reason ? `: „${reason}“` : ''} — vyřiďte to v sekci Žádosti.`,
          email: {
            subject: 'Žádost o přístup k dobrovolníkům',
            body:
              `<p>Organizátor <strong>${escapeHtml(who)}</strong> žádá o přístup k poolu dobrovolníků vaší obce a mikroregionu.</p>` +
              (reason ? `<p><strong>Zdůvodnění:</strong><br/>${escapeHtml(reason).replace(/\n/g, '<br/>')}</p>` : '') +
              '<p>Schválit nebo zamítnout ji můžete v sekci Žádosti.</p>',
          },
        })
      }
      return
    }
    const alsoPool = doc.volunteerAccessRequested ? ' a o přístup k dobrovolníkům' : ''
    for (const adminId of adminIds) {
      sendNotification(req.payload, {
        userId: adminId,
        title: 'Nová žádost o roli organizátora',
        link: requestsLink,
        message: `${who} žádá o roli organizátora za „${doc.organizationName}“${alsoPool}: „${reason}“ — vyřiďte to v sekci Žádosti.`,
        email: {
          subject: 'Nová žádost o roli organizátora',
          body:
            `<p><strong>${escapeHtml(who)}</strong> ve vaší obci požádal(a) o roli organizátora za <strong>${escapeHtml(doc.organizationName ?? '')}</strong>${alsoPool}.</p>` +
            `<p><strong>Zdůvodnění:</strong><br/>${escapeHtml(reason).replace(/\n/g, '<br/>')}</p>` +
            '<p>Schválit nebo zamítnout ji můžete v sekci Žádosti.</p>',
        },
      })
    }
    return
  }

  if (operation === 'update' && doc.status !== previousDoc?.status && accessOnly) {
    if (doc.status === 'approved') {
      // The trusted path that opens the pool to an organizer — in the approval's own transaction: an
      // organizer who has lost the role meanwhile fails the approval instead of leaving it "approved".
      const role = (
        await req.payload.find({
          collection: 'user-roles',
          where: {
            and: [{ user: { equals: userId } }, { municipality: { equals: municipalityId } }, { role: { equals: 'organizer' } }],
          },
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
        })
      ).docs[0]
      if (!role) throw new APIError('Žadatel už v obci není organizátorem — přístup k dobrovolníkům mu dát nejde.', 409)
      if (!role.volunteerAccess) {
        await req.payload.update({
          collection: 'user-roles',
          id: role.id,
          data: { volunteerAccess: true },
          overrideAccess: true,
          context: { volunteerAccessByRequest: true },
          req,
        })
      }
      sendNotification(req.payload, {
        userId,
        title: 'Přístup k dobrovolníkům schválen',
        link: '/organizace',
        message: 'Obec vám schválila přístup k poolu dobrovolníků — teď můžete dobrovolníky zvát a hledat je na svých akcích.',
        email: {
          subject: 'Přístup k dobrovolníkům schválen',
          body: '<p>Obec vám schválila přístup k poolu dobrovolníků — teď můžete dobrovolníky zvát a hledat je na svých akcích.</p>',
        },
      })
    } else if (doc.status === 'rejected') {
      sendNotification(req.payload, {
        userId,
        title: 'Žádost o přístup k dobrovolníkům zamítnuta',
        link: '/organizace',
        message: 'Obec vaši žádost o přístup k poolu dobrovolníků zamítla.',
        email: {
          subject: 'Žádost o přístup k dobrovolníkům zamítnuta',
          body: '<p>Obec vaši žádost o přístup k poolu dobrovolníků bohužel zamítla.</p>',
        },
      })
    }
    writeAuditLog(req.payload, {
      source: req,
      action: doc.status === 'approved' ? 'organizer-requests.approve-volunteer-access' : 'organizer-requests.reject-volunteer-access',
      actor: req.user?.id ?? null,
      targetCollection: 'organizer-requests',
      targetId: doc.id,
      municipality: municipalityId,
      metadata: { requestedBy: userId },
    })
    return
  }

  if (operation === 'update' && doc.status !== previousDoc?.status) {
    if (doc.status === 'approved') {
      const poolGranted = Boolean(doc.volunteerAccessGranted)
      // The one trusted path allowed to grant the role — in the approval's own transaction (`req`):
      // a role that can't be granted fails the approval too, instead of leaving a request marked
      // approved for someone who still can't organize. One granted meanwhile some other way stays.
      const granted = await req.payload.count({
        collection: 'user-roles',
        where: {
          and: [{ user: { equals: userId } }, { municipality: { equals: municipalityId } }, { role: { equals: 'organizer' } }],
        },
        overrideAccess: true,
        req,
      })
      if (granted.totalDocs === 0) {
        await req.payload.create({
          collection: 'user-roles',
          data: { user: userId, municipality: municipalityId, role: 'organizer', volunteerAccess: poolGranted },
          overrideAccess: true,
          // UserRoles creates the organization the obec just approved along with the role.
          // The applicant's reason becomes the organization's description on its profile.
          context: {
            organization: { name: doc.organizationName, type: doc.organizationType, description: doc.reason },
          },
          req,
        })
      } else if (poolGranted) {
        // A role granted meanwhile some other way stays — it only gets the pool the obec opened here.
        const existing = await req.payload.find({
          collection: 'user-roles',
          where: {
            and: [{ user: { equals: userId } }, { municipality: { equals: municipalityId } }, { role: { equals: 'organizer' } }],
          },
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
        })
        const role = existing.docs[0]
        if (role && !role.volunteerAccess) {
          await req.payload.update({
            collection: 'user-roles',
            id: role.id,
            data: { volunteerAccess: true },
            overrideAccess: true,
            context: { volunteerAccessByRequest: true },
            req,
          })
        }
      }
      // Straight to the organization the obec just approved — they may run several, one per obec.
      const organization = await req.payload
        .find({
          collection: 'organizations',
          where: { and: [{ owner: { equals: userId } }, { municipality: { equals: municipalityId } }] },
          depth: 0,
          limit: 1,
          overrideAccess: true,
          // Just created above, in this transaction — invisible outside it.
          req,
        })
        .catch(() => null)
      const organizationId = organization?.docs[0]?.id
      // An obec that has since switched to founding its events itself only takes organizers on as
      // spolupořadatelé (Events canCreateEvent).
      const municipality = await req.payload
        .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true, req })
        .catch(() => null)
      const canCreate = municipality?.rulesForCreation !== 'municipality_only'
      const what = canCreate
        ? 'teď můžete zakládat akce'
        : 'můžete spolupořádat akce, ke kterým vás obec pozve — nové akce v obci teď zakládá jen obec sama'
      // What they asked for about the pool, and what the obec decided on it.
      const pool = poolGranted
        ? ' Obec vám dala i přístup k poolu dobrovolníků.'
        : doc.volunteerAccessRequested
          ? ' Přístup k poolu dobrovolníků vám obec zatím neschválila — požádat o něj můžete později znovu.'
          : ''
      sendNotification(req.payload, {
        userId,
        title: 'Role organizátora schválena',
        link: organizationId ? `/organizace?organizace=${organizationId}` : '/organizace',
        message: doc.organizationName
          ? `Vaše žádost o roli organizátora byla schválena — za „${doc.organizationName}“ ${what}.${pool}`
          : `Vaše žádost o roli organizátora byla schválena — ${what}.${pool}`,
        email: {
          subject: 'Role organizátora schválena',
          body: `<p>Vaše žádost o roli organizátora byla schválena — ${escapeHtml(what)}.</p>${pool ? `<p>${escapeHtml(pool.trim())}</p>` : ''}`,
        },
      })
      writeAuditLog(req.payload, {
        source: req,
        action: 'organizer-requests.approve',
        actor: req.user?.id ?? null,
        targetCollection: 'organizer-requests',
        targetId: doc.id,
        municipality: municipalityId,
        metadata: { requestedBy: userId, volunteerAccessRequested: Boolean(doc.volunteerAccessRequested), volunteerAccessGranted: poolGranted },
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
        source: req,
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

/**
 * A request for the volunteer pool alone — by someone who already organizes in the obec without it.
 * The reason is optional here: the obec already knows them.
 */
async function validateVolunteerAccessRequest(
  data: Record<string, unknown>,
  req: PayloadRequest,
): Promise<Record<string, unknown>> {
  data.volunteerAccessRequested = true
  data.organizationName = null
  data.organizationType = null
  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  data.reason = reason || null

  const role = (
    await req.payload.find({
      collection: 'user-roles',
      where: {
        and: [{ user: { equals: data.user } }, { municipality: { equals: data.municipality } }, { role: { equals: 'organizer' } }],
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
  ).docs[0]
  if (!role) throw new APIError('O přístup k dobrovolníkům žádá jen organizátor obce.', 400)
  if (role.volunteerAccess) throw new APIError('Přístup k dobrovolníkům v téhle obci už máte.', 400)

  const pending = await req.payload.count({
    collection: 'organizer-requests',
    where: {
      and: [
        { user: { equals: data.user } },
        { municipality: { equals: data.municipality } },
        { status: { equals: 'pending' } },
        { kind: { equals: VOLUNTEER_ACCESS_KIND } },
      ],
    },
    overrideAccess: true,
    req,
  })
  if (pending.totalDocs > 0) throw new APIError('Vaše žádost o přístup k dobrovolníkům už čeká na vyřízení.', 400)
  return data
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
    // The obec's admins (and a platform admin) — or the applicant, taking back their own request
    // while it still waits; a decided one stays as the record of the decision.
    delete: async (args) => {
      const admin = await isPlatformOrMunicipalityAdmin()(args)
      if (admin === true) return true
      const user = args.req.user
      if (!user) return false
      const own: Where = { and: [{ user: { equals: user.id } }, { status: { equals: 'pending' } }] }
      return admin ? { or: [admin as Where, own] } : own
    },
  },
  fields: [
    {
      // What the obec is asked for — the organizer role, or (for an organizer already) access to the
      // volunteer pool alone. Fixed once asked.
      name: 'kind',
      type: 'select',
      defaultValue: ORGANIZER_ROLE_KIND,
      access: { update: () => false },
      options: [
        { label: 'Organizer role', value: ORGANIZER_ROLE_KIND },
        { label: 'Volunteer pool access', value: VOLUNTEER_ACCESS_KIND },
      ],
    },
    {
      // The applicant asks for the obec's (and its mikroregion's) volunteer pool too. Fixed once asked.
      name: 'volunteerAccessRequested',
      type: 'checkbox',
      defaultValue: false,
      access: { update: () => false },
    },
    {
      // The obec's decision on the pool — set only along with approving a request that asked for it
      // (beforeValidate below). Never by the applicant: they can't update a request at all, and the
      // field can't be filed with a new one.
      name: 'volunteerAccessGranted',
      type: 'checkbox',
      defaultValue: false,
      access: { create: platformAdminField },
    },
    {
      // Fixed once asked — the obec decides on this person and this obec, not on whatever a PATCH
      // makes of the request afterwards.
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: { update: () => false },
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
      access: { update: () => false },
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
      // A request starts waiting on the obec — never filed as already decided.
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'pending',
      access: { create: platformAdminField },
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
    },
    {
      // Stamped with the decision (beforeValidate) — never taken from the client.
      name: 'reviewedBy',
      type: 'relationship',
      relationTo: 'users',
      access: { create: platformAdminField, update: platformAdminField },
      admin: { position: 'sidebar' },
    },
    {
      name: 'reviewedAt',
      type: 'date',
      access: { create: platformAdminField, update: platformAdminField },
      admin: { position: 'sidebar' },
    },
  ],
  hooks: {
    // No new organizers for a read-only obec — neither asked for nor approved (lib/billing/status).
    beforeOperation: [
      guardReadOnlyObec({ collection: 'organizer-requests', operations: ['create', 'update'], municipalityOf: (r) => r.municipality }),
    ],
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.user || !data?.municipality) return data
        if (operation !== 'create') return data

        // Whatever a client sends, a new request starts undecided on the pool too.
        data.volunteerAccessGranted = false
        if (data.kind === VOLUNTEER_ACCESS_KIND) return validateVolunteerAccessRequest(data, req)
        data.kind = ORGANIZER_ROLE_KIND
        data.volunteerAccessRequested = data.volunteerAccessRequested === true

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
              { kind: { not_equals: VOLUNTEER_ACCESS_KIND } },
            ],
          },
          limit: 1,
          overrideAccess: true,
        })
        if (existing.docs.length > 0) {
          throw new APIError('Vaše žádost o roli organizátora v téhle obci už čeká na vyřízení.', 400)
        }

        // Asked by the person themselves (not a platform admin filing one, nor a trusted internal
        // write): only for the obec they live in — and one that still lets organizers in, whose
        // admin doesn't already run events for it.
        if (req.user && req.user.role !== 'admin') {
          const profile = (
            await req.payload.find({
              collection: 'profiles',
              where: { user: { equals: data.user } },
              depth: 0,
              limit: 1,
              overrideAccess: true,
              req,
            })
          ).docs[0]
          if (!profile?.municipality || String(relationId(profile.municipality)) !== String(relationId(data.municipality))) {
            throw new APIError('O roli organizátora se žádá jen ve vaší domovské obci.', 400)
          }
        }
        const municipality = await req.payload
          .findByID({ collection: 'municipalities', id: relationId(data.municipality)!, depth: 0, overrideAccess: true, req })
          .catch(() => null)
        if (!municipality) throw new APIError('Obec nebyla nalezena.', 404)
        if (municipality.rulesForCreation === 'municipality_only') {
          throw new APIError('Akce v téhle obci teď zakládá jen obec sama — o roli organizátora požádat nejde.', 400)
        }
        const adminHere = await req.payload.count({
          collection: 'user-roles',
          where: {
            and: [
              { user: { equals: data.user } },
              { municipality: { equals: data.municipality } },
              { role: { equals: 'municipality_admin' } },
            ],
          },
          overrideAccess: true,
          req,
        })
        if (adminHere.totalDocs > 0) {
          throw new APIError('Jako admin obce pořádáte akce za obec — roli organizátora v ní nepotřebujete.', 400)
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
          throw new APIError('V téhle obci už roli organizátora máte.', 400)
        }

        return data
      },
      // Stamp reviewedBy/reviewedAt whenever status is set on update (approve/reject). A decision
      // is final — approving a rejected request (or the other way round) would grant or leave a
      // role nobody asked about now.
      ({ data, req, operation, originalDoc }) => {
        if (operation !== 'update' || !data) return data
        const deciding = Boolean(data.status && data.status !== originalDoc?.status)
        if (deciding) {
          if (originalDoc?.status !== 'pending') {
            throw new APIError('O žádosti už bylo rozhodnuto.', 409)
          }
          data.reviewedBy = req.user?.id
          data.reviewedAt = new Date().toISOString()
        }
        // The pool is decided once, together with the request — only by approving it, and only when
        // it was asked for. A request for the pool alone grants it by being approved.
        if (originalDoc?.kind === VOLUNTEER_ACCESS_KIND) {
          if (deciding) data.volunteerAccessGranted = data.status === 'approved'
          else delete data.volunteerAccessGranted
          return data
        }
        const granting = data.volunteerAccessGranted
        if (granting !== undefined && Boolean(granting) !== Boolean(originalDoc?.volunteerAccessGranted)) {
          if (!deciding || data.status !== 'approved') {
            throw new APIError('O přístupu k dobrovolníkům se rozhoduje jen spolu se schválením žádosti.', 400)
          }
          if (granting && !originalDoc?.volunteerAccessRequested) {
            throw new APIError('Žadatel o přístup k dobrovolníkům nežádal.', 400)
          }
        }
        if (deciding && data.status !== 'approved') data.volunteerAccessGranted = false
        else if (deciding) data.volunteerAccessGranted = Boolean(granting) && Boolean(originalDoc?.volunteerAccessRequested)
        return data
      },
    ],
    afterChange: [notifyOnRequestChange],
  },
  timestamps: true,
}
