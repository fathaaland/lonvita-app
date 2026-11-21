import { NextResponse } from 'next/server'
import { APIError, commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { sendNotification } from '@/collections/shared/notify'
import { assertObecWritable } from '@/collections/shared/readOnlyObec'
import { VOLUNTEER_ACCESS_KIND } from '@/lib/organizer-request-kinds'
import { relationId, requiredRelationNumber } from '@/lib/relations'

/**
 * The obec opens its volunteer pool to one of its organizers, or closes it again — the one way to
 * change UserRoles.volunteerAccess after the role was granted (the collection's `update` is closed
 * over REST). For the obec's admins and a platform admin only; an organizer never decides it for
 * themselves. Invitations already sent stay as they are.
 *
 * POST /api/user-roles/:id/volunteer-access  { volunteerAccess: boolean } → { volunteerAccess }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { volunteerAccess?: unknown } | null
  if (typeof body?.volunteerAccess !== 'boolean') {
    return NextResponse.json({ error: 'Chybí, jestli má organizátor přístup k dobrovolníkům.' }, { status: 400 })
  }
  const grant = body.volunteerAccess

  const role = await payload.findByID({ collection: 'user-roles', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!role || role.role !== 'organizer') {
    return NextResponse.json({ error: 'Role organizátora neexistuje.' }, { status: 404 })
  }
  const municipalityId = relationId(role.municipality)!
  const organizerId = requiredRelationNumber(role.user)
  if (user.role !== 'admin') {
    if (!(await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (organizerId === user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (Boolean(role.volunteerAccess) === grant) return NextResponse.json({ volunteerAccess: grant })

  const req = await createLocalReq({ user }, payload)
  const shouldCommit = await initTransaction(req)
  try {
    if (grant) await assertObecWritable(req, municipalityId)

    // A request for the pool still waiting is answered by this — approving it opens the pool and
    // tells the organizer (OrganizerRequests).
    const waiting = grant
      ? (
          await payload.find({
            collection: 'organizer-requests',
            where: {
              and: [
                { user: { equals: organizerId } },
                { municipality: { equals: municipalityId } },
                { kind: { equals: VOLUNTEER_ACCESS_KIND } },
                { status: { equals: 'pending' } },
              ],
            },
            depth: 0,
            limit: 1,
            overrideAccess: true,
            req,
          })
        ).docs[0]
      : undefined

    if (waiting) {
      await payload.update({ collection: 'organizer-requests', id: waiting.id, data: { status: 'approved' }, overrideAccess: true, req })
    } else {
      await payload.update({
        collection: 'user-roles',
        id: role.id,
        data: { volunteerAccess: grant },
        overrideAccess: true,
        req,
      })
      sendNotification(payload, {
        userId: organizerId,
        category: 'my_requests',
        title: grant ? 'Přístup k dobrovolníkům povolen' : 'Přístup k dobrovolníkům odebrán',
        link: '/organizace',
        message: grant
          ? 'Obec vám povolila přístup k poolu dobrovolníků — teď můžete dobrovolníky zvát a hledat je na svých akcích.'
          : 'Obec vám odebrala přístup k poolu dobrovolníků. Pozvánky, které už jste poslali, platí dál; nové posílat nemůžete.',
        email: {
          subject: grant ? 'Přístup k dobrovolníkům povolen' : 'Přístup k dobrovolníkům odebrán',
          body: grant
            ? '<p>Obec vám povolila přístup k poolu dobrovolníků — teď můžete dobrovolníky zvát a hledat je na svých akcích.</p>'
            : '<p>Obec vám odebrala přístup k poolu dobrovolníků.</p><p>Pozvánky, které už jste poslali, platí dál; nové posílat nemůžete.</p>',
        },
      })
      writeAuditLog(payload, {
        source: req,
        action: grant ? 'user-roles.grant-volunteer-access' : 'user-roles.revoke-volunteer-access',
        actor: user.id,
        targetCollection: 'user-roles',
        targetId: role.id,
        municipality: Number(municipalityId),
        metadata: { organizer: organizerId },
      })
    }
    if (shouldCommit) await commitTransaction(req)
    return NextResponse.json({ volunteerAccess: grant })
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    if (error instanceof APIError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
