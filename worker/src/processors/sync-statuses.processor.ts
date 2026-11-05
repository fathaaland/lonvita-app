import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import {
  CANCELLATION_ANNOUNCED_ACTION,
  cancellationJobId,
  notifyEventCancelled,
} from '@/collections/shared/eventNotifications'
import { escapeHtml, sendNotification } from '@/collections/shared/notify'
import { logger, serializeError } from '@/lib/logger'
import { relationId } from '@/lib/relations'

import { BATCH_SIZE, inBatches } from '../runtime/batches'
import { getWorkerPayload } from '../runtime/payload'

import type { SyncStatusesJobResult } from '@/lib/queue/contracts'
import type { CollectionSlug, Payload, Where } from 'payload'

/** An event is over once its end — or, without one, its start — has passed (the same rule as
 * Events' deriveFinishedStatus). Cancelled ones stay cancelled. */
const finishedEvents = (now: string): Where => ({
  and: [
    { status: { in: ['active', 'full'] } },
    {
      or: [
        { endDateTime: { less_than: now } },
        { and: [{ endDateTime: { exists: false } }, { dateTime: { less_than: now } }] },
      ],
    },
  ],
})

/** Still waiting on the other organizers, or on the obec after the requester turned to it. */
const expiredDeletionRequests = (now: string): Where => ({
  and: [{ status: { in: ['pending', 'escalated'] } }, { expiresAt: { less_than_equal: now } }],
})

const expiredCoOrganizingInvitations = (now: string): Where => ({
  and: [{ status: { equals: 'pending' } }, { expiresAt: { less_than_equal: now } }],
})

/**
 * Straight to the database adapter, not payload.update: this is the clock moving, not someone
 * editing — none of the collections' change hooks (edit notifications, capacity broadcasts,
 * the obec's "your event was changed") should hear about it, and updatedAt stays put (the
 * adapter stamps it unless it's passed as an explicit null).
 */
async function setStatus(
  payload: Payload,
  collection: CollectionSlug,
  where: Where,
  status: string,
): Promise<number> {
  return inBatches(async () => {
    const docs = await payload.db.updateMany({
      collection,
      where,
      data: { status, updatedAt: null },
      limit: BATCH_SIZE,
      select: { id: true },
    })
    return docs?.length ?? 0
  })
}

/**
 * A volunteer's invitation or offer still waiting when the event starts can't be accepted any more
 * (VolunteerInvitations applyDecision), yet it went on showing as waiting on the volunteer's
 * profile for good. Withdrawn — the state the system already puts the ones it settles in.
 * The pending ones are few (each lapses here within a quarter of an hour of its event), so they're
 * read whole and matched against their events' start.
 */
async function withdrawLapsedVolunteerInvitations(payload: Payload, now: string): Promise<number> {
  const pending = await payload.find({
    collection: 'volunteer-invitations',
    where: { status: { equals: 'pending' } },
    select: { event: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const eventIds = [...new Set(pending.docs.map((i) => (typeof i.event === 'object' ? i.event.id : i.event)))]
  if (eventIds.length === 0) return 0
  const started = await payload.find({
    collection: 'events',
    where: { and: [{ id: { in: eventIds } }, { dateTime: { less_than_equal: now } }] },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  if (started.docs.length === 0) return 0
  return setStatus(
    payload,
    'volunteer-invitations',
    { and: [{ status: { equals: 'pending' } }, { event: { in: started.docs.map((e) => e.id) } }] },
    'withdrawn',
  )
}

/**
 * A request to delete the event that the others let lapse without a word. The event stays — but the
 * requester may now turn to the obec (escalate route), so they hear both. Read before the bulk
 * update marks them expired, told after it.
 */
async function lapsingUnansweredDeletionRequests(payload: Payload, now: string) {
  const lapsing = await payload.find({
    collection: 'event-deletion-requests',
    where: { and: [{ status: { equals: 'pending' } }, { expiresAt: { less_than_equal: now } }] },
    select: { event: true, eventTitle: true, requestedBy: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return lapsing.docs
}

async function tellRequestersOfLapse(
  payload: Payload,
  requests: Awaited<ReturnType<typeof lapsingUnansweredDeletionRequests>>,
): Promise<void> {
  for (const request of requests) {
    const eventId = relationId(request.event)
    const requesterId = relationId(request.requestedBy)
    if (!eventId || !requesterId) continue
    const event = await payload
      .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (!event || event.deletedAt || event.status === 'cancelled') continue
    const canEscalate = new Date(event.dateTime).getTime() > Date.now()
    const next = canEscalate
      ? ' Pokud ji pořádat nechcete, můžete požádat obec, aby vás z ní odebrala.'
      : ''
    try {
      await sendNotification(payload, {
        userId: requesterId,
        title: 'Na žádost o smazání nikdo neodpověděl',
        link: `/akce/${eventId}`,
        message: `Na vaši žádost o smazání akce „${request.eventTitle}“ nikdo včas neodpověděl — akce zůstává.${next}`,
        email: {
          subject: `Žádost o smazání akce vypršela: ${request.eventTitle}`,
          body:
            `<p>Na vaši žádost o smazání akce <strong>${escapeHtml(request.eventTitle)}</strong> nikdo včas neodpověděl — akce zůstává.</p>` +
            (next ? `<p>${escapeHtml(next.trim())}</p>` : ''),
        },
      })
    } catch (error) {
      logger.error('Lapsed deletion request notice failed', {
        event: 'statuses.deletion_request_lapse_notice_failed',
        requestId: request.id,
        ...serializeError(error),
      })
    }
  }
}

/** A cancel's announcement waits on the queue for this long before it counts as lost. */
const CANCELLATION_CATCH_UP_AFTER_MS = 15 * 60 * 1000
/** And is looked for this far back — older ones are past helping (the event has long happened). */
const CANCELLATION_CATCH_UP_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * A cancelled event nobody was told about: the cancel committed but its job never reached the
 * queue (Redis down at that moment — the hook only logs it). Found by the missing
 * `events.cancel_notified` entry the job writes once it has told everyone, and queued again under the
 * job id the hook would have used — one still waiting (a slow queue) swallows it instead of doubling.
 */
async function catchUpCancellationNotices(payload: Payload, now: Date): Promise<number> {
  const { rows } = await (payload.db as unknown as PostgresAdapter).drizzle.execute(sql`
    SELECT e.id FROM events e
    WHERE e.deleted_at IS NOT NULL
      AND e.deleted_at > ${new Date(now.getTime() - CANCELLATION_CATCH_UP_WINDOW_MS).toISOString()}::timestamptz
      AND e.deleted_at < ${new Date(now.getTime() - CANCELLATION_CATCH_UP_AFTER_MS).toISOString()}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.action = ${CANCELLATION_ANNOUNCED_ACTION}
          AND a.target_id = e.id::text
          AND a.created_at >= e.deleted_at
      )
    ORDER BY e.deleted_at
    LIMIT 50`)
  let queued = 0
  for (const { id } of rows as { id: number }[]) {
    try {
      const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true })
      if (!event.deletedAt) continue
      await notifyEventCancelled(payload, event, { jobId: cancellationJobId(event.id, event.deletedAt) })
      queued++
    } catch (error) {
      logger.error('Lost cancellation notice not queued', {
        event: 'statuses.cancellation_catch_up_failed',
        eventId: id,
        ...serializeError(error),
      })
    }
  }
  if (queued > 0) {
    logger.warn('Cancellation notices caught up', { event: 'statuses.cancellation_caught_up', queued })
  }
  return queued
}

export const processSyncStatusesJob = async (): Promise<SyncStatusesJobResult> => {
  const payload = await getWorkerPayload()
  const now = new Date().toISOString()

  const eventsFinished = await setStatus(payload, 'events', finishedEvents(now), 'finished')
  const unanswered = await lapsingUnansweredDeletionRequests(payload, now)
  const deletionRequestsExpired = await setStatus(
    payload,
    'event-deletion-requests',
    expiredDeletionRequests(now),
    'expired',
  )
  await tellRequestersOfLapse(payload, unanswered)
  const coOrganizingInvitationsExpired = await setStatus(
    payload,
    'co-organizing-requests',
    expiredCoOrganizingInvitations(now),
    'expired',
  )

  const volunteerInvitationsWithdrawn = await withdrawLapsedVolunteerInvitations(payload, now)
  const cancellationNoticesCaughtUp = await catchUpCancellationNotices(payload, new Date(now))

  // Runs every quarter of an hour — only worth an info line when it actually changed something.
  const changed =
    eventsFinished + deletionRequestsExpired + coOrganizingInvitationsExpired + volunteerInvitationsWithdrawn + cancellationNoticesCaughtUp
  logger[changed > 0 ? 'info' : 'debug']('Status sync finished', {
    event: 'statuses.sync_finished',
    eventsFinished,
    deletionRequestsExpired,
    coOrganizingInvitationsExpired,
    volunteerInvitationsWithdrawn,
    cancellationNoticesCaughtUp,
  })

  return {
    eventsFinished,
    deletionRequestsExpired,
    coOrganizingInvitationsExpired,
    volunteerInvitationsWithdrawn,
    cancellationNoticesCaughtUp,
  }
}
