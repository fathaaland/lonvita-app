import { NextResponse } from 'next/server'
import { APIError, createLocalReq, getPayload } from 'payload'

import config from '@payload-config'
import { isEventCreator } from '@/collections/Events'
import { hasEventEnded } from '@/lib/eventEnded'

/**
 * The event's creator marks it as one for volunteers (or takes the mark off) — no obec approval —
 * straight from a list of events (EventsTable), without opening the whole edit form. Events
 * guardIsVolunteering still decides who may flip it (Events isEventCreator).
 *
 * POST /api/events/:id/volunteering  { isVolunteering: boolean }
 * → { isVolunteering: boolean }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { isVolunteering?: unknown } | null
  if (typeof body?.isVolunteering !== 'boolean') {
    return NextResponse.json({ error: 'Chybí, jestli je akce dobrovolnická.' }, { status: 400 })
  }

  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') {
    return NextResponse.json({ error: 'Akce neexistuje nebo už byla zrušena.' }, { status: 404 })
  }
  if (!(await isEventCreator(await createLocalReq({ user }, payload), user, event))) {
    return NextResponse.json({ error: 'Dobrovolnictví u akce nastavuje jen ten, kdo ji založil.' }, { status: 403 })
  }
  if (hasEventEnded(event.dateTime, event.endDateTime)) {
    return NextResponse.json({ error: 'Akce už proběhla — upravit ji nejde.' }, { status: 400 })
  }

  try {
    const updated = await payload.update({
      collection: 'events',
      id: event.id,
      data: { isVolunteering: body.isVolunteering },
      user,
      overrideAccess: true,
      // The creator's own change to their own event — nobody else needs telling.
      context: { skipNotifications: true },
    })
    return NextResponse.json({ isVolunteering: Boolean(updated.isVolunteering) })
  } catch (error) {
    // E.g. a volunteer has signed up meanwhile — the mark stays (Events guardIsVolunteering).
    if (error instanceof APIError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
