import type { Payload } from 'payload'

import { notDeleted } from '@/collections/shared/softDelete'
import { summarizeOrganizationFeedback } from '@/lib/organization-feedback'

import type { CategoryRow, EventRow, RegistrationRow } from '@/lib/analytics'
import type { OrganizationFeedbackSummary } from '@/lib/organization-stats'
import type { ProfileWithDob } from '@/lib/report'
import type { Event } from '@/payload-types'

/**
 * The worker's side of admin-queries.ts / queries.ts: the same rows the admin pages load over
 * REST, read straight from the database and mapped to the exact shapes the pure analytics
 * functions expect — so a downloaded file shows the numbers the page shows. Access is checked
 * when the export is requested (lib/exports/access.ts); these read with overrideAccess, so they
 * re-apply the soft-delete filters the collections' own read access would.
 */

const toId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

export const toEventRow = (e: Event): EventRow => ({
  id: String(e.id),
  title: e.title,
  date_time: e.dateTime,
  capacity: e.capacity,
  status: e.status ?? 'active',
  category_ids: (e.categories ?? []).map(toId).filter((v): v is string => Boolean(v)),
  organizer_id: toId(e.organizer) ?? '',
  created_at: e.createdAt,
  is_paid: e.isPaid ?? undefined,
  price_cents: e.priceCents ?? null,
  is_volunteering: e.isVolunteering ?? undefined,
})

export async function loadRegistrations(payload: Payload, eventIds: string[]): Promise<RegistrationRow[]> {
  if (eventIds.length === 0) return []
  const result = await payload.find({
    collection: 'registrations',
    where: { and: [{ event: { in: eventIds } }, notDeleted] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return result.docs.map((r) => ({
    id: String(r.id),
    event_id: toId(r.event)!,
    user_id: toId(r.user)!,
    status: r.status,
    created_at: r.createdAt,
    attendance_status: (r.attendanceStatus ?? 'not_marked') as RegistrationRow['attendance_status'],
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
      where: { and: [{ municipality: { equals: municipalityId } }, notDeleted] },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'profiles',
      where: { and: [{ municipality: { equals: municipalityId } }, notDeleted] },
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
        ],
      },
      sort: '-dateTime',
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    loadCategories(payload),
    summarizeOrganizationFeedback(payload, organizationId),
  ])

  const events = eventsResult.docs.map(toEventRow)
  const coOrganizedIds = new Set(
    eventsResult.docs.filter((e) => toId(e.organization) !== organizationId).map((e) => String(e.id)),
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
