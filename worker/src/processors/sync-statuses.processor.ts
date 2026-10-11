import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { SyncStatusesJobResult } from '@/lib/queue/contracts'
import type { CollectionSlug, Payload, Where } from 'payload'

/** Bounded batches, like the cleanups: a backlog (the worker was down for a week) shouldn't turn
 * into one huge write. Whatever is left past MAX_BATCHES waits for the next run. */
const BATCH_SIZE = 500
const MAX_BATCHES = 100

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
  let updated = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const docs = await payload.db.updateMany({
      collection,
      where,
      data: { status, updatedAt: null },
      limit: BATCH_SIZE,
      select: { id: true },
    })
    const count = docs?.length ?? 0
    updated += count
    if (count < BATCH_SIZE) break
  }
  return updated
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

export const processSyncStatusesJob = async (): Promise<SyncStatusesJobResult> => {
  const payload = await getWorkerPayload()
  const now = new Date().toISOString()

  const eventsFinished = await setStatus(payload, 'events', finishedEvents(now), 'finished')
  const deletionRequestsExpired = await setStatus(
    payload,
    'event-deletion-requests',
    expiredDeletionRequests(now),
    'expired',
  )
  const coOrganizingInvitationsExpired = await setStatus(
    payload,
    'co-organizing-requests',
    expiredCoOrganizingInvitations(now),
    'expired',
  )

  const volunteerInvitationsWithdrawn = await withdrawLapsedVolunteerInvitations(payload, now)

  // Runs every quarter of an hour — only worth an info line when it actually changed something.
  const changed = eventsFinished + deletionRequestsExpired + coOrganizingInvitationsExpired + volunteerInvitationsWithdrawn
  logger[changed > 0 ? 'info' : 'debug']('Status sync finished', {
    event: 'statuses.sync_finished',
    eventsFinished,
    deletionRequestsExpired,
    coOrganizingInvitationsExpired,
    volunteerInvitationsWithdrawn,
  })

  return { eventsFinished, deletionRequestsExpired, coOrganizingInvitationsExpired, volunteerInvitationsWithdrawn }
}
