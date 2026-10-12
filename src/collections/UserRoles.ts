import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeOperationHook,
  CollectionConfig,
  PayloadRequest,
  Where,
} from 'payload'
import { APIError } from 'payload'

import {
  canCreateForAdministeredMunicipality,
  getAdministeredMunicipalityIds,
  isPlatformOrMunicipalityAdmin,
} from './access/shared'
import { writeAuditLog } from './shared/auditLog'
import { escapeHtml, sendNotification } from './shared/notify'
import { ensureOrganization, municipalityOrganizationIds } from './Organizations'
import { notYetEnded, obecRole, releasePlacesOfTeam } from './Events'
import { notDeleted } from './shared/softDelete'
import { findRunningEvents } from './shared/runningEvents'
import type { OrganizationType } from '@/lib/organizations'
import { relationId, requiredRelationNumber } from '@/lib/relations'

/**
 * A newly appointed obec admin hears what's already waiting on the obec — an organizer who asked
 * before the obec had an admin was told to the platform admins (getObecDeciders), so the new admin
 * would otherwise find the request only by chance in Žádosti.
 */
const notifyNewAdminOfWaitingRequests: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (doc.role !== 'municipality_admin') return doc
  const municipalityId = requiredRelationNumber(doc.municipality)
  if (previousDoc?.role === 'municipality_admin' && requiredRelationNumber(previousDoc.municipality) === municipalityId) return doc

  const now = new Date().toISOString()
  const count = (collection: 'organizer-requests' | 'co-organizing-requests' | 'event-deletion-requests' | 'review-complaints', where: Where[]) =>
    req.payload
      .count({ collection, where: { and: [{ municipality: { equals: municipalityId } }, ...where] }, overrideAccess: true, req })
      .then((r) => r.totalDocs)
  const [organizerRequests, coOrganizing, escalated, complaints] = await Promise.all([
    count('organizer-requests', [{ status: { equals: 'pending' } }]),
    count('co-organizing-requests', [
      { status: { equals: 'pending' } },
      { organizationOwner: { exists: false } },
      { expiresAt: { greater_than: now } },
    ]),
    count('event-deletion-requests', [{ status: { equals: 'escalated' } }, { expiresAt: { greater_than: now } }]),
    count('review-complaints', [{ status: { equals: 'pending' } }]),
  ])
  const total = organizerRequests + coOrganizing + escalated + complaints
  if (total === 0) return doc

  const parts = [
    organizerRequests && `žádosti o roli organizátora: ${organizerRequests}`,
    coOrganizing && `pozvánky ke spolupořádání: ${coOrganizing}`,
    escalated && `žádosti o zrušení spolupořadatelství: ${escalated}`,
    complaints && `stížnosti na recenze: ${complaints}`,
  ].filter(Boolean) as string[]
  const municipality = await req.payload
    .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  const obec = municipality ? `Obec ${municipality.name}` : 'Obec'
  sendNotification(req.payload, {
    userId: requiredRelationNumber(doc.user),
    title: 'Na vyřízení čekají žádosti',
    link: '/admin-obce?tab=requests',
    message: `${obec} má na vyřízení — ${parts.join(', ')}. Najdete je v Přehledu obce v sekci Žádosti.`,
    email: {
      subject: 'Na vyřízení čekají žádosti',
      body:
        `<p>Jste nově adminem obce. ${escapeHtml(obec)} má na vyřízení:</p>` +
        `<ul>${parts.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` +
        '<p>Najdete je v Přehledu obce v sekci Žádosti.</p>',
    },
  })
  return doc
}

/**
 * An obec always keeps at least one admin — without one, nobody approves its organizers, decides
 * escalated deletions or reviews complaints there. Taking the last "municipality_admin" away is the
 * platform admin's call alone (they then look after the obec themselves, or appoint someone);
 * an obec's own admin can step down only once there's another. Only when access control applies
 * (every REST request) — trusted internal deletes pass, and account deletion checks the same thing
 * up front (anonymizeUser).
 */
const keepLastMunicipalityAdmin: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'delete') return args
  const { id, where, overrideAccess } = args as { id?: number | string; where?: Where; overrideAccess?: boolean }
  if (overrideAccess !== false || !req.user || req.user.role === 'admin') return args

  const removing = await req.payload.find({
    collection: 'user-roles',
    where: { and: [id !== undefined ? { id: { equals: id } } : (where ?? {}), { role: { equals: 'municipality_admin' } }] },
    select: { municipality: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (removing.docs.length === 0) return args

  const removedPerObec = new Map<number, number>()
  for (const role of removing.docs) {
    const municipalityId = requiredRelationNumber(role.municipality)
    removedPerObec.set(municipalityId, (removedPerObec.get(municipalityId) ?? 0) + 1)
  }
  for (const [municipalityId, removed] of removedPerObec) {
    const { totalDocs } = await req.payload.count({
      collection: 'user-roles',
      where: { and: [{ municipality: { equals: municipalityId } }, { role: { equals: 'municipality_admin' } }] },
      overrideAccess: true,
      req,
    })
    if (totalDocs - removed < 1) {
      throw new APIError(
        'Obec by zůstala bez admina — jediný admin obce se odebrat nedá. Dalšího admina jí nejdřív určí správce Lonvity.',
        400,
      )
    }
  }
  return args
}

/**
 * A role doesn't go while its holder still runs events in the obec under it — they'd go on under
 * someone who no longer organizes there (and who'd keep seeing their registrants): the organizer's
 * own and co-organized events, and the events an obec admin founded for the obec (its pořadatel is
 * still them). Once they've taken place or been cancelled, it can. Only when access control applies,
 * like keepLastMunicipalityAdmin: deleting an organization or an account handles its events itself.
 */
const keepRunningEventsOrganized: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'delete') return args
  const { id, where, overrideAccess } = args as { id?: number | string; where?: Where; overrideAccess?: boolean }
  if (overrideAccess !== false || !req.user) return args

  const removing = await req.payload.find({
    collection: 'user-roles',
    where: {
      and: [id !== undefined ? { id: { equals: id } } : (where ?? {}), { role: { in: ['organizer', 'municipality_admin'] } }],
    },
    select: { user: true, municipality: true, role: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const role of removing.docs) {
    const municipalityId = requiredRelationNumber(role.municipality)
    const obecOrganizationId = (await municipalityOrganizationIds(req, [municipalityId])).get(String(municipalityId))
    const asObec = role.role === 'municipality_admin'
    // Each role answers for the events run under it: the ones its admin founded for the obec, and
    // the rest — their own, and those their organization co-organizes — for the organizer.
    const running = (await findRunningEvents(req, requiredRelationNumber(role.user), municipalityId)).filter(
      (e) => (e.organizes === 'runs' && relationId(e.organization) === obecOrganizationId) === asObec,
    )
    if (running.length > 0) {
      const what = running.length === 1 ? 'rozjetou akci' : `rozjeté akce (${running.length})`
      throw new APIError(
        asObec
          ? `Admin obce má v obci ${what}, které je pořadatelem — roli mu půjde odebrat, až proběhnou, nebo když se zruší.`
          : `Organizátor má v obci ${what} — roli mu půjde odebrat, až proběhnou, nebo když se zruší.`,
        409,
      )
    }
  }
  return args
}

/** Only a platform admin appoints an obec's admins; an obec's own admin may grant the organizer
 * role in it — and only there (canCreateForAdministeredMunicipality checks the obec). */
const canCreateRole: Access = async (args) => {
  const { req, data } = args
  if (req.user?.role === 'admin') return true
  if ((data as { role?: unknown } | undefined)?.role !== 'organizer') return false
  return canCreateForAdministeredMunicipality()(args)
}

export const UserRoles: CollectionConfig = {
  slug: 'user-roles',
  labels: {
    singular: 'User Role',
    plural: 'User Roles',
  },
  admin: {
    useAsTitle: 'role',
    defaultColumns: ['user', 'role', 'municipality', 'updatedAt'],
  },
  access: {
    // Their own roles, and every role in an obec they administer — the obec's admin lists its
    // organizers to revoke the role (Administrace obce → Žádosti), which delete below already
    // allows. Without the second half that list was always empty: the right existed, the way to it didn't.
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
      const or: Where[] = [{ user: { equals: user.id } }]
      if (administeredIds.length > 0) or.push({ municipality: { in: administeredIds } })
      return { or }
    },
    // create ignores any Where clause (see canCreateForAdministeredMunicipality) — must resolve
    // to a boolean checked against the submitted row's own municipality.
    create: canCreateRole,
    // A role is granted or taken away, never rewritten — turning one into another (or moving it to
    // another obec, or person) would skip every check on revoking it (keepLastMunicipalityAdmin,
    // keepRunningEventsOrganized) and on granting it.
    update: () => false,
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
      admin: {
        description: 'The municipality this role applies to.',
      },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      options: [
        { label: 'Municipality Admin', value: 'municipality_admin' },
        { label: 'Organizer', value: 'organizer' },
        {
          label: 'Prescriber (plán)',
          value: 'prescriber',
        },
      ],
      admin: {
        description:
          'What someone may do in an obec — where they live is Profiles.municipality, not a role. Enum follows ERD §0.2 pilot roles, plus "organizer" (brief §4). A user can hold the same role in several municipalities at once — organizers and volunteers aren\'t tied to one town (brief §8 "Působení jednoho člověka napříč víc obcemi"). "prescriber" is a reserved slot for the intervention layer — not wired to any workflow yet (see brief §B).',
      },
    },
  ],
  hooks: {
    beforeOperation: [keepLastMunicipalityAdmin, keepRunningEventsOrganized],
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.user || !data?.role || !data?.municipality) return data

        const userId = data.user
        const role = data.role
        const municipality = data.municipality

        // Scoped to (user, role, municipality), not just (user, role) — the same person can
        // hold "organizer" (or, in principle, any role) in several municipalities at once.
        if (
          operation === 'update' &&
          originalDoc?.user === userId &&
          originalDoc?.role === role &&
          originalDoc?.municipality === municipality
        ) {
          return data
        }

        const existing = await req.payload.find({
          collection: 'user-roles',
          where: {
            and: [
              { user: { equals: userId } },
              { role: { equals: role } },
              { municipality: { equals: municipality } },
            ],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error(`This user already has the "${role}" role in this municipality.`)
        }

        // The obec's admin runs events as the obec, never as an organization of it (Organizations).
        if (role === 'organizer') {
          const adminHere = await req.payload.count({
            collection: 'user-roles',
            where: {
              and: [
                { user: { equals: userId } },
                { role: { equals: 'municipality_admin' } },
                { municipality: { equals: municipality } },
              ],
            },
            overrideAccess: true,
            req,
          })
          if (adminHere.totalDocs > 0) {
            throw new APIError('Admin obce pořádá akce za obec — roli organizátora v ní mít nemůže.', 400)
          }
        }

        // An obec may have several municipality_admin users, but an admin may only administer
        // one obec at a time — unlike "organizer" above, this role isn't meant to span towns.
        if (role === 'municipality_admin') {
          const elsewhere = await req.payload.find({
            collection: 'user-roles',
            where: {
              and: [
                { user: { equals: userId } },
                { role: { equals: 'municipality_admin' } },
                { municipality: { not_equals: municipality } },
              ],
            },
            depth: 0,
            limit: 1,
          })

          if (elsewhere.docs.length > 0) {
            throw new Error('This user is already the municipality admin of a different obec.')
          }
        }

        return data
      },
    ],
    afterChange: [
      // Granting "municipality_admin" (e.g. via the superadmin panel's "Přidat roli") used to only
      // ever write this user-roles row — the admin's own profile.municipality (their dashboard's
      // home obec, see page.tsx's `viewing` default) never followed, so they'd land on "Všechny
      // obce"/their old town on next login instead of the obec they were just put in charge of.
      // The beforeValidate hook above guarantees a user holds "municipality_admin" for at most one
      // obec at a time, so forcing their profile to match here is always safe.
      async ({ doc, req }) => {
        if (doc.role !== 'municipality_admin') return doc

        const userId = requiredRelationNumber(doc.user)
        const municipalityId = requiredRelationNumber(doc.municipality)
        const profiles = await req.payload.find({
          collection: 'profiles',
          where: { user: { equals: userId } },
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
        })
        const profile = profiles.docs[0]
        if (!profile) return doc

        const currentMunicipalityId = profile.municipality == null ? null : requiredRelationNumber(profile.municipality)
        if (currentMunicipalityId !== municipalityId) {
          await req.payload.update({
            collection: 'profiles',
            id: profile.id,
            data: { municipality: municipalityId },
            overrideAccess: true,
            req,
          })
        }
        return doc
      },
      // A new obec admin takes part in every event the obec runs or co-organizes automatically —
      // their own place on one that's still ahead goes (Events releasePlacesOfTeam).
      async ({ doc, previousDoc, req }) => {
        if (doc.role !== 'municipality_admin') return doc
        const municipalityId = requiredRelationNumber(doc.municipality)
        if (previousDoc?.role === 'municipality_admin' && requiredRelationNumber(previousDoc.municipality) === municipalityId) return doc

        const userId = requiredRelationNumber(doc.user)
        const [registrations, invitations] = await Promise.all([
          req.payload.find({
            collection: 'registrations',
            where: { and: [{ user: { equals: userId } }, { status: { in: ['pending', 'approved'] } }] },
            select: { event: true },
            depth: 0,
            pagination: false,
            overrideAccess: true,
            req,
          }),
          req.payload.find({
            collection: 'volunteer-invitations',
            where: { and: [{ volunteer: { equals: userId } }, { status: { equals: 'pending' } }] },
            select: { event: true },
            depth: 0,
            pagination: false,
            overrideAccess: true,
            req,
          }),
        ])
        const eventIds = [...new Set([...registrations.docs, ...invitations.docs].map((r) => requiredRelationNumber(r.event)))]
        if (eventIds.length === 0) return doc

        const events = await req.payload.find({
          collection: 'events',
          where: {
            and: [
              { id: { in: eventIds } },
              { municipality: { equals: municipalityId } },
              { status: { not_equals: 'cancelled' } },
              notDeleted,
              notYetEnded(),
            ],
          },
          depth: 0,
          pagination: false,
          overrideAccess: true,
          req,
        })
        for (const event of events.docs) {
          const { runs, coOrganizes } = await obecRole(req, event)
          if (runs || coOrganizes) await releasePlacesOfTeam(req, event.id, [userId])
        }
        return doc
      },
      // Whoever organizes in an obec does so as an organization (Organizations.ts) — created with
      // the role, whichever way it's granted. An approved OrganizerRequest passes the name and
      // type the obec approved via `context.organization`; any other grant gets an "individual".
      async ({ doc, previousDoc, req }) => {
        if (doc.role !== 'organizer' || previousDoc?.role === 'organizer') return doc
        const requested = req.context?.organization as
      | { name?: string; type?: OrganizationType; description?: string | null }
      | undefined
        await ensureOrganization(req, {
          owner: requiredRelationNumber(doc.user),
          municipality: requiredRelationNumber(doc.municipality),
          name: requested?.name,
          type: requested?.type,
          description: requested?.description,
        })
        return doc
      },
      notifyNewAdminOfWaitingRequests,
      ({ doc, req, operation }) => {
        if (operation !== 'create') return
        writeAuditLog(req.payload, {
          source: req,
          action: 'user-roles.grant',
          actor: req.user?.id ?? null,
          targetCollection: 'user-roles',
          targetId: doc.id,
          municipality:
            typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality,
          metadata: { grantedTo: requiredRelationNumber(doc.user), role: doc.role },
        })
      },
    ],
    // Brief §3 "kdo oprávnění uděluje, ten ho může kdykoliv i zpětně odebrat" — grants are
    // audited on create above; this is the matching trail for revocation (a hard DELETE, see
    // revokeCommunityRole in superadmin-queries.ts), which previously left no audit record.
    afterDelete: [
      // Someone else took the role away (the obec's admin, or the platform admin) — the holder hears
      // it, rather than finding out from a "Vytvořit" button that's no longer there.
      async ({ doc, req, context }) => {
        if (context?.accountDeleted || context?.deletingMunicipality || !req.user || String(req.user.id) === String(requiredRelationNumber(doc.user))) return
        if (doc.role !== 'organizer' && doc.role !== 'municipality_admin') return
        const municipality = await req.payload
          .findByID({ collection: 'municipalities', id: requiredRelationNumber(doc.municipality), depth: 0, overrideAccess: true, req })
          .catch(() => null)
        const obec = municipality ? `obci ${municipality.name}` : 'obci'
        const what = doc.role === 'organizer' ? 'roli organizátora' : 'roli admina obce'
        const after =
          doc.role === 'organizer'
            ? 'Nové akce tam zakládat nemůžete. S dotazy se obraťte na obec.'
            : 'Administraci obce už neuvidíte.'
        sendNotification(req.payload, {
          userId: requiredRelationNumber(doc.user),
          title: doc.role === 'organizer' ? 'Role organizátora odebrána' : 'Role admina obce odebrána',
          link: '/profil',
          message: `V ${obec} vám byla odebrána ${what}. ${after}`,
          email: {
            subject: doc.role === 'organizer' ? 'Role organizátora odebrána' : 'Role admina obce odebrána',
            body: `<p>V ${escapeHtml(obec)} vám byla odebrána ${what}.</p><p>${escapeHtml(after)}</p>`,
          },
        })
      },
      ({ doc, req }) => {
        writeAuditLog(req.payload, {
          source: req,
          action: 'user-roles.revoke',
          actor: req.user?.id ?? null,
          targetCollection: 'user-roles',
          targetId: doc.id,
          municipality:
            typeof doc.municipality === 'object' ? doc.municipality.id : doc.municipality,
          metadata: { revokedFrom: requiredRelationNumber(doc.user), role: doc.role },
        })
      },
    ],
  },
  timestamps: true,
}
