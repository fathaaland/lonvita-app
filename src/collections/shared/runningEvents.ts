import type { PayloadRequest, Where } from 'payload'

import { notYetEnded } from '../Events'
import { notDeleted } from './softDelete'
import type { Event } from '@/payload-types'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** An event the organizer still runs in the obec — as its pořadatel, or through their organization
 * among its spolupořadatelé. */
export type RunningEvent = Event & { organizes: 'runs' | 'co-organizes' }

/**
 * The organizer's events in the obec that haven't taken place yet and aren't cancelled. While there
 * are any, their organizer role can't be taken away (UserRoles keepRunningEventsOrganized) — the
 * events would go on under someone who no longer organizes there.
 */
export async function findRunningEvents(
  req: PayloadRequest,
  userId: number | string,
  municipalityId: number | string,
): Promise<RunningEvent[]> {
  const organizations = await req.payload.find({
    collection: 'organizations',
    where: { and: [{ owner: { equals: userId } }, { municipality: { equals: municipalityId } }] },
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const organizes: Where[] = [{ organizer: { equals: userId } }]
  if (organizations.docs.length > 0) organizes.push({ coOrganizations: { in: organizations.docs.map((o) => o.id) } })

  const events = await req.payload.find({
    collection: 'events',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { status: { not_equals: 'cancelled' } },
        notDeleted,
        notYetEnded(),
        { or: organizes },
      ],
    },
    sort: 'dateTime',
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return events.docs.map((event) => ({
    ...event,
    organizes: relationId(event.organizer) === String(userId) ? 'runs' : 'co-organizes',
  }))
}
