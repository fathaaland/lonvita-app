import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { notDeleted } from '@/collections/shared/softDelete'
import { ANONYMOUS_NAME } from '@/collections/shared/anonymizeUser'

const CANDIDATE_LIMIT = 20
/** Invitations listed for the obec — waiting ones, and answers from the last month. */
const RECENT_ANSWERS_DAYS = 30

const relId = (value: unknown) => String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * For "Pozvat do poolu" in the obec's admin: residents of the obec who could be invited (searched by
 * name — who is in the pool already isn't readable over REST, see Profiles canReadVolunteerFields),
 * and the obec's invitations with the invited people's names.
 *
 * GET /api/admin/pool-invitations?municipality=1&q=nov
 * → { candidates: { user_id, full_name }[], invitations: { id, user_id, full_name, status, created_at }[] }
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const municipalityId = params.get('municipality')
  if (!municipalityId || !/^\d+$/.test(municipalityId)) {
    return NextResponse.json({ error: 'Chybí obec.' }, { status: 400 })
  }
  if (user.role !== 'admin' && !(await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const since = new Date(Date.now() - RECENT_ANSWERS_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const invitations = await payload.find({
    collection: 'pool-invitations',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { or: [{ status: { equals: 'pending' } }, { decidedAt: { greater_than: since } }] },
      ],
    },
    sort: '-createdAt',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const pendingUserIds = new Set(invitations.docs.filter((i) => i.status === 'pending').map((i) => relId(i.user)))

  const q = (params.get('q') ?? '').trim()
  const candidates =
    q.length < 2
      ? []
      : (
          await payload.find({
            collection: 'profiles',
            where: {
              and: [
                notDeleted,
                { municipality: { equals: municipalityId } },
                { fullName: { like: q } },
                // A deleted account keeps its profile, nameless — nobody to ask.
                { fullName: { not_equals: ANONYMOUS_NAME } },
                { isVolunteer: { not_equals: true } },
                { user: { not_equals: user.id } },
              ],
            },
            sort: 'fullName',
            depth: 0,
            limit: CANDIDATE_LIMIT + pendingUserIds.size,
            overrideAccess: true,
          })
        ).docs
          .filter((p) => !pendingUserIds.has(relId(p.user)))
          .slice(0, CANDIDATE_LIMIT)
          .map((p) => ({ user_id: relId(p.user), full_name: p.fullName }))

  const invitedIds = [...new Set(invitations.docs.map((i) => relId(i.user)))]
  const names =
    invitedIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await payload.find({
              collection: 'profiles',
              where: { user: { in: invitedIds } },
              depth: 0,
              pagination: false,
              overrideAccess: true,
            })
          ).docs.map((p) => [relId(p.user), p.fullName]),
        )

  return NextResponse.json({
    candidates,
    invitations: invitations.docs.map((i) => ({
      id: String(i.id),
      user_id: relId(i.user),
      full_name: names.get(relId(i.user)) ?? 'Anonymní uživatel',
      status: i.status,
      created_at: i.createdAt,
    })),
  })
}
