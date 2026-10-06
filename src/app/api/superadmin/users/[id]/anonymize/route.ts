import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { deleteAccount } from '@/collections/shared/anonymizeUser'

/**
 * The superadmin panel's "Smazat účet" — the same anonymization someone deleting their own account
 * gets (shared/anonymizeUser), so the overviews keep their history whoever deletes it. A hard delete
 * of a user is closed over the API (Users.access.delete).
 *
 * POST /api/superadmin/users/:id/anonymize → { deleted: true }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const userId = Number((await context.params).id)
  if (!userId) return NextResponse.json({ error: 'Účet neexistuje.' }, { status: 404 })

  const result = await deleteAccount(payload, user, userId)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ deleted: true })
}
