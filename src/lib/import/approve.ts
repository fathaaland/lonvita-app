import type { Payload, PayloadRequest } from 'payload'
import {
  APIError,
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
} from 'payload'

import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'
import { formatPragueEventTime, pragueDateKey } from '@/lib/date'
import { relationId, relationNumber } from '@/lib/relations'
import type { EventImportCandidate, User } from '@/payload-types'

import { IMPORT_WARNINGS, isReadyToApprove, type ImportWarning } from './contracts'

/**
 * Approving an imported candidate is founding the event — as the obec, by its admin, through the
 * Events collection with access control on (`overrideAccess: false`): every rule a hand-made event
 * meets (a future start, a place inside the obec's area, a category, the organizer role) holds for an
 * imported one too, and nothing here opens a way around them. The candidate is marked approved in
 * the same transaction. Without edits from the form it goes in as the import found it — only when
 * nothing is missing (isReadyToApprove) — with unlimited capacity and sign-up without approval,
 * which is what a calendar listing is: anyone may come.
 */

export type ApprovalInput = {
  title: string
  description: string | null
  dateTime: string
  endDateTime: string | null
  locationText: string
  lat: number
  lng: number
  categoryIds: number[]
  capacity: number
  registrationApprovalMode: 'auto' | 'manual'
  accessibilityTags: string[]
  imageId: number | null
  imagePositionX: number
  imagePositionY: number
  isVolunteering: boolean
  isPaid: boolean
  priceCents: number | null
}

type Actor = Pick<User, 'id' | 'role'>

async function loadForDecision(
  payload: Payload,
  user: Actor,
  candidateId: number | string,
): Promise<EventImportCandidate> {
  const candidate = await payload
    .findByID({
      collection: 'event-import-candidates',
      id: candidateId,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null)
  if (!candidate) throw new APIError('Akce k převzetí neexistuje.', 404)
  const municipalityId = relationId(candidate.municipality)!
  const administers = (await getAdministeredMunicipalityIds(payload, Number(user.id))).includes(
    municipalityId,
  )
  if (!administers && user.role !== 'admin')
    throw new APIError('O akcích k převzetí rozhoduje admin obce.', 403)
  if (candidate.status !== 'pending') throw new APIError('O téhle akci už bylo rozhodnuto.', 409)
  return candidate
}

/** The event as the import found it — or why it can't go in without opening it first. */
export function approvalFromCandidate(candidate: EventImportCandidate): ApprovalInput {
  const warnings = (candidate.warnings as string[] | null) ?? []
  if (!isReadyToApprove(warnings)) {
    const first = warnings[0] as ImportWarning
    throw new APIError(IMPORT_WARNINGS[first] ?? 'Akci nejdřív doplňte.', 400)
  }
  if (candidate.lat == null || candidate.lng == null || !candidate.locationText) {
    throw new APIError(IMPORT_WARNINGS.location_missing, 400)
  }
  const categoryIds = (candidate.categories ?? []).map((c) => relationNumber(c)!).filter(Boolean)
  if (categoryIds.length === 0) throw new APIError(IMPORT_WARNINGS.no_category, 400)

  // Events keeps an end only for a multi-day event — a same-day end time goes into the description.
  const multiDay =
    Boolean(candidate.endsAt) &&
    pragueDateKey(candidate.endsAt!) > pragueDateKey(candidate.startsAt)
  const sameDayEnd =
    candidate.endsAt && !multiDay ? ` Konec akce v ${formatPragueEventTime(candidate.endsAt)}.` : ''
  const description = `${candidate.description ?? ''}${sameDayEnd}`.trim() || null

  return {
    title: candidate.title,
    description,
    dateTime: candidate.startsAt,
    endDateTime: multiDay ? candidate.endsAt! : null,
    locationText: candidate.locationText,
    lat: candidate.lat,
    lng: candidate.lng,
    categoryIds,
    capacity: UNLIMITED_CAPACITY,
    registrationApprovalMode: 'auto',
    accessibilityTags: [],
    imageId: null,
    imagePositionX: 50,
    imagePositionY: 50,
    isVolunteering: false,
    isPaid: Boolean(candidate.isPaid),
    priceCents:
      candidate.isPaid && candidate.priceCzk ? Math.round(candidate.priceCzk * 100) : null,
  }
}

/** Where the event was taken from — its own page, else the source it was found on. */
async function importedFromOf(
  payload: Payload,
  candidate: EventImportCandidate,
  req: PayloadRequest,
): Promise<string | null> {
  if (candidate.detailUrl) return candidate.detailUrl
  const sourceId = relationId(candidate.source)
  if (!sourceId) return null
  const source = await payload
    .findByID({ collection: 'event-sources', id: sourceId, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  return source?.url ?? null
}

/** Founds the event from the candidate — with the admin's edits from the form, or as imported. */
export async function approveCandidate(
  payload: Payload,
  user: Actor,
  candidateId: number | string,
  edits?: ApprovalInput,
  source?: { headers?: unknown },
): Promise<{ eventId: number }> {
  const candidate = await loadForDecision(payload, user, candidateId)
  const municipalityId = Number(relationId(candidate.municipality))
  if (
    !(await getAdministeredMunicipalityIds(payload, Number(user.id))).includes(
      String(municipalityId),
    )
  ) {
    // The event is founded as the obec — by one of its admins, who hold the role there (Events requireOrganizerRole).
    throw new APIError('Akci za obec převezme její admin.', 403)
  }
  const input = edits ?? approvalFromCandidate(candidate)

  const req = await createLocalReq({ user: user as never }, payload)
  const shouldCommit = await initTransaction(req)
  let eventId: number
  try {
    const importedFrom = await importedFromOf(payload, candidate, req)
    const event = await payload.create({
      collection: 'events',
      data: {
        title: input.title,
        description: input.description ?? undefined,
        municipality: municipalityId,
        dateTime: input.dateTime,
        endDateTime: input.endDateTime ?? undefined,
        locationText: input.locationText,
        lat: input.lat,
        lng: input.lng,
        accessibilityTags: input.accessibilityTags as never,
        capacity: input.capacity,
        registrationApprovalMode: input.registrationApprovalMode,
        organizer: Number(user.id),
        categories: input.categoryIds,
        image: input.imageId ?? undefined,
        imagePositionX: input.imagePositionX,
        imagePositionY: input.imagePositionY,
        status: 'active',
        isVolunteering: input.isVolunteering,
        isPaid: input.isPaid,
        priceCents: input.isPaid ? (input.priceCents ?? undefined) : undefined,
      },
      user: user as never,
      overrideAccess: false,
      context: { importedFrom },
      req,
    })
    eventId = event.id
    await payload.update({
      collection: 'event-import-candidates',
      id: candidate.id,
      data: {
        status: 'approved',
        event: event.id,
        decidedBy: Number(user.id),
        decidedAt: new Date().toISOString(),
      },
      overrideAccess: true,
      req,
    })
    if (shouldCommit) await commitTransaction(req)
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    throw error
  }

  writeAuditLog(payload, {
    source,
    action: 'event-import-candidates.approve',
    actor: Number(user.id),
    targetCollection: 'event-import-candidates',
    targetId: candidate.id,
    municipality: municipalityId,
    metadata: { event: eventId, edited: Boolean(edits) },
  })
  return { eventId }
}

/** Sets the candidate aside — it won't come back on the next pass over its source. */
export async function rejectCandidate(
  payload: Payload,
  user: Actor,
  candidateId: number | string,
): Promise<void> {
  const candidate = await loadForDecision(payload, user, candidateId)
  await payload.update({
    collection: 'event-import-candidates',
    id: candidate.id,
    data: { status: 'rejected', decidedBy: Number(user.id), decidedAt: new Date().toISOString() },
    overrideAccess: true,
  })
}
