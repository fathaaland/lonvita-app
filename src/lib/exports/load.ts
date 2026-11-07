import type { Payload } from 'payload'

import { notDeleted } from '@/collections/shared/softDelete'
import { summarizeOrganizationFeedback } from '@/lib/organization-feedback'

import { toEventRow } from '@/lib/analytics'
import type { CategoryRow, EventRow, FeedbackRow, RegistrationRow } from '@/lib/analytics'
import type { OrganizationFeedbackSummary } from '@/lib/organization-stats'
import type { ProfileWithDob } from '@/lib/report'
import { relationId } from '@/lib/relations'

/**
 * The worker's side of admin-queries.ts / queries.ts: the same rows the admin pages load over
 * REST, read straight from the database and mapped to the exact shapes the pure analytics
 * functions expect — so a downloaded file shows the numbers the page shows. Access is checked
 * when the export is requested (lib/exports/access.ts); these read with overrideAccess, so they
 * re-apply the soft-delete filters the collections' own read access would.
 */

/** Ids per query — Postgres takes at most 65 535 parameters in one statement, and an obec's history
 * of registrations runs past that; a list that long in one `in` turned the dashboard into a 500. */
const ID_CHUNK = 5_000

async function inChunks<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(...(await load(ids.slice(i, i + ID_CHUNK))))
  return out
}

export async function loadRegistrations(payload: Payload, eventIds: string[]): Promise<RegistrationRow[]> {
  if (eventIds.length === 0) return []
  const docs = await inChunks(eventIds, async (chunk) =>
    (
      await payload.find({
        collection: 'registrations',
        where: { and: [{ event: { in: chunk } }, notDeleted] },
        // Only what the rows below are made of — an obec's whole history can be a lot of registrations.
        select: { event: true, user: true, status: true, createdAt: true, attendanceStatus: true, role: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs,
  )
  return docs.map((r) => ({
    id: String(r.id),
    event_id: relationId(r.event)!,
    user_id: relationId(r.user)!,
    status: r.status,
    created_at: r.createdAt,
    attendance_status: (r.attendanceStatus ?? 'not_marked') as RegistrationRow['attendance_status'],
    // Volunteers hold no place — without the role the file counted them as participants, the page didn't.
    role: r.role ?? 'participant',
  }))
}

/** Ratings of these registrations — the ones a complaint had removed (soft-deleted) left out, as
 * EventFeedback's own read access leaves them out of the page. */
export async function loadFeedback(payload: Payload, registrationIds: string[]): Promise<FeedbackRow[]> {
  if (registrationIds.length === 0) return []
  const docs = await inChunks(registrationIds, async (chunk) =>
    (
      await payload.find({
        collection: 'event-feedback',
        where: { and: [{ registration: { in: chunk } }, notDeleted] },
        select: { registration: true, satisfactionRating: true, feltWelcomeRating: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs,
  )
  return docs.map((f) => ({
    id: String(f.id),
    registration_id: relationId(f.registration)!,
    satisfaction_rating: f.satisfactionRating,
    felt_welcome_rating: f.feltWelcomeRating ?? null,
  }))
}

async function loadCategories(payload: Payload): Promise<CategoryRow[]> {
  const result = await payload.find({ collection: 'event-categories', depth: 0, pagination: false, overrideAccess: true })
  return result.docs.map((c) => ({ id: String(c.id), name: c.name, icon: c.icon ?? '', color: c.color ?? '' }))
}

export type MunicipalityExportData = {
  municipalityName: string
  events: EventRow[]
  registrations: RegistrationRow[]
  profiles: ProfileWithDob[]
  categories: CategoryRow[]
}

/** The obec dashboard's data (admin-obce/page.tsx). `organizerId` narrows it to "Jen moje akce". */
export async function loadMunicipalityExportData(
  payload: Payload,
  municipalityId: string,
  organizerId?: string,
): Promise<MunicipalityExportData> {
  const [municipality, eventsResult, profilesResult, categories] = await Promise.all([
    payload.findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true }),
    payload.find({
      collection: 'events',
      // Someone's draft isn't the obec's yet (Events isDraft).
      where: { and: [{ municipality: { equals: municipalityId } }, notDeleted, { isDraft: { not_equals: true } }] },
      select: { title: true, dateTime: true, endDateTime: true, capacity: true, status: true, categories: true, organizer: true, municipality: true, createdAt: true, isPaid: true, priceCents: true, isVolunteering: true, organization: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'profiles',
      where: { and: [{ municipality: { equals: municipalityId } }, notDeleted] },
      select: { user: true, fullName: true, createdAt: true, dateOfBirth: true, over50: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    loadCategories(payload),
  ])

  const allEvents = eventsResult.docs.map(toEventRow)
  const events = organizerId ? allEvents.filter((e) => e.organizer_id === organizerId) : allEvents
  const registrations = await loadRegistrations(payload, events.map((e) => e.id))

  return {
    municipalityName: municipality.name,
    events,
    registrations,
    profiles: profilesResult.docs.map((p) => ({
      id: String(p.id),
      user_id: relationId(p.user) ?? '',
      full_name: p.fullName,
      created_at: p.createdAt,
      date_of_birth: p.dateOfBirth ?? null,
      over_50: Boolean(p.over50),
    })),
    categories,
  }
}

export type OrganizationExportData = {
  organizationName: string
  events: EventRow[]
  /** Events it only co-organizes — counted separately on the page. */
  coOrganizedIds: Set<string>
  registrations: RegistrationRow[]
  categories: CategoryRow[]
  feedback: OrganizationFeedbackSummary
}

/** The "Organizace" page's data (organizace/page.tsx): every event it runs or co-organizes, newest first. */
export async function loadOrganizationExportData(payload: Payload, organizationId: string): Promise<OrganizationExportData> {
  const [organization, eventsResult, categories, feedback] = await Promise.all([
    payload.findByID({ collection: 'organizations', id: organizationId, depth: 0, overrideAccess: true }),
    payload.find({
      collection: 'events',
      where: {
        and: [
          { or: [{ organization: { equals: organizationId } }, { coOrganizations: { contains: organizationId } }] },
          notDeleted,
          { isDraft: { not_equals: true } },
        ],
      },
      sort: '-dateTime',
      select: { title: true, dateTime: true, endDateTime: true, capacity: true, status: true, categories: true, organizer: true, municipality: true, createdAt: true, isPaid: true, priceCents: true, isVolunteering: true, organization: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    loadCategories(payload),
    summarizeOrganizationFeedback(payload, organizationId),
  ])

  const events = eventsResult.docs.map(toEventRow)
  const coOrganizedIds = new Set(
    eventsResult.docs.filter((e) => relationId(e.organization) !== organizationId).map((e) => String(e.id)),
  )

  return {
    organizationName: organization.name,
    events,
    coOrganizedIds,
    registrations: await loadRegistrations(payload, events.map((e) => e.id)),
    categories,
    feedback,
  }
}
