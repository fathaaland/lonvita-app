import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import {
  deleteAccount,
  findEventsBlockingDeletion,
  findMunicipalitiesSolelyAdministeredBy,
} from '@/collections/shared/anonymizeUser'
import { ACCOUNT_DELETION_CONFIRMATION } from '@/lib/accountDeletion'

/**
 * What stands between the signed-in user and deleting their account — the events ahead they still
 * run or co-organize, and the obce they're the only admin of. The profile's "Smazat účet" dialog
 * lists them instead of the button.
 *
 * GET /api/account/delete → { blockingEvents: [{ id, title, date_time }], soleAdminOf: [{ id, name }] }
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [blockingEvents, soleAdminOf] = await Promise.all([
    findEventsBlockingDeletion(payload, user.id),
    findMunicipalitiesSolelyAdministeredBy(payload, user.id),
  ])
  return NextResponse.json({ blockingEvents, soleAdminOf })
}

/**
 * Deletes the signed-in user's own account — anonymizes it, so what they took part in keeps counting
 * in the obec's and the organizers' overviews (shared/anonymizeUser) — and signs them out.
 *
 * POST /api/account/delete  { confirm: "SMAZAT" } → { deleted: true }
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
  if (body?.confirm !== ACCOUNT_DELETION_CONFIRMATION) {
    return NextResponse.json({ error: `Pro smazání účtu napište „${ACCOUNT_DELETION_CONFIRMATION}“.` }, { status: 400 })
  }

  const result = await deleteAccount(payload, user, user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const response = NextResponse.json({ deleted: true })
  response.cookies.delete('payload-token')
  return response
}
