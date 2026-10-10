import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { eventOrganizerIds } from '@/collections/Events'
import { escapeHtml, getEventTeamUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { hasEventEnded } from '@/lib/eventEnded'
import { EVENT_MESSAGE_MAX_LENGTH } from '@/lib/eventMessage'
import { logger } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/** Every message is a notification and an e-mail to everyone signed up — a few per hour is plenty for
 * "sraz se přesouvá", and stops a slip of the finger (or anything worse) from mailing the same people
 * over and over. */
const MESSAGE_RATE_LIMIT = { max: 3, windowSeconds: 60 * 60 }

const relId = (value: unknown) => String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * A message from the people running the event to everyone signed up for it (pending and approved,
 * volunteers included) — in the app and by e-mail (SMS go out only when an event is cancelled). The
 * one way to reach them once sign-up
 * has closed: in the last REGISTRATION_CUTOFF_HOURS the list is frozen and the event can't be
 * cancelled any more, but the meeting point can still move or the weather turn. Until it's over.
 *
 * POST /api/events/:id/message  { message } → { recipients }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { message?: unknown } | null
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'Napište, co chcete přihlášeným vzkázat.' }, { status: 400 })
  if (message.length > EVENT_MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ error: `Zpráva může mít nejvýš ${EVENT_MESSAGE_MAX_LENGTH} znaků.` }, { status: 400 })
  }

  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') {
    return NextResponse.json({ error: 'Akce neexistuje nebo už byla zrušena.' }, { status: 404 })
  }

  // The event's team: its organizers, the admins of its obec (who oversee every event there), a
  // platform admin. The same people who manage its registrations.
  const runsIt =
    user.role === 'admin' ||
    eventOrganizerIds(event).includes(String(user.id)) ||
    (await getAdministeredMunicipalityIds(payload, user.id)).includes(relId(event.municipality))
  if (!runsIt) return NextResponse.json({ error: 'Přihlášeným píše jen ten, kdo akci pořádá.' }, { status: 403 })

  if (hasEventEnded(event.dateTime, event.endDateTime)) {
    return NextResponse.json({ error: 'Akce už proběhla.' }, { status: 409 })
  }

  const limit = await consumeRateLimit({ namespace: `event-message:${event.id}`, identifier: String(user.id), ...MESSAGE_RATE_LIMIT })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Přihlášeným jste psali už několikrát za poslední hodinu. Zkuste to prosím později.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  const registrations = await payload.find({
    collection: 'registrations',
    where: { and: [{ event: { equals: event.id } }, { status: { in: ['pending', 'approved'] } }, { deletedAt: { exists: false } }] },
    select: { user: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const team = new Set(await getEventTeamUserIds(payload, event))
  const recipients = [...new Set(registrations.docs.map((r) => relId(r.user)))].filter((uid) => !team.has(uid))

  const title = `Zpráva od pořadatele: ${event.title}`
  const announcementId = `event-message-${event.id}-${Date.now()}`
  await sendNotificationToMany(
    payload,
    recipients,
    {
      title,
      message,
      link: `/akce/${event.id}`,
      email: {
        subject: title,
        body: `<p>Pořadatel akce <strong>${escapeHtml(event.title)}</strong> vzkazuje:</p><blockquote>${escapeHtml(message).replace(/\n/g, '<br/>')}</blockquote>`,
      },
      critical: true,
    },
    { jobIdPrefix: announcementId },
  )

  logger.info('Event message sent', {
    event: 'events.message_sent',
    eventId: event.id,
    userId: user.id,
    recipients: recipients.length,
    correlationId: correlationIdFromHeaders(request.headers),
  })
  return NextResponse.json({ recipients: recipients.length })
}
