import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { reliabilityOf } from '@/collections/shared/reliability'

/**
 * The signed-in user's own reliability (lib/reliability) — the same numbers the organizers see next
 * to their registrations, shown on their profile ("Vaše docházka"), and whether their sign-ups for
 * events without approval wait for the organizer for now.
 *
 * GET /api/account/reliability → { attended, excused, noShows, restrictedUntil }
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(await reliabilityOf(payload, user.id))
}
