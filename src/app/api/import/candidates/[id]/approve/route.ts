import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'
import { approveCandidate, type ApprovalInput } from '@/lib/import/approve'
import { decisionErrorResponse } from '@/lib/import/routes'

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/** The form's values, shaped — their meaning (a future start, a place in the obec…) is checked by
 * the Events collection itself when the event is created. */
function parseEdits(body: Record<string, unknown>): ApprovalInput | string {
  const title = text(body.title)
  const dateTime = text(body.dateTime)
  const locationText = text(body.locationText)
  const lat = finite(body.lat)
  const lng = finite(body.lng)
  const categoryIds = Array.isArray(body.categoryIds)
    ? body.categoryIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : []
  if (!title) return 'Vyplňte název akce.'
  if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) return 'Vyplňte začátek akce.'
  if (!locationText || lat === null || lng === null) return 'Vyberte místo konání na mapě.'
  if (categoryIds.length === 0) return 'Vyberte alespoň jednu kategorii.'
  const capacity = finite(body.capacity)
  const endDateTime = text(body.endDateTime)
  return {
    title,
    description: text(body.description),
    dateTime,
    endDateTime: endDateTime && !Number.isNaN(new Date(endDateTime).getTime()) ? endDateTime : null,
    locationText,
    lat,
    lng,
    categoryIds,
    capacity:
      capacity && capacity >= 1
        ? Math.min(Math.round(capacity), UNLIMITED_CAPACITY)
        : UNLIMITED_CAPACITY,
    registrationApprovalMode: body.registrationApprovalMode === 'manual' ? 'manual' : 'auto',
    accessibilityTags: Array.isArray(body.accessibilityTags)
      ? body.accessibilityTags.filter((t): t is string => typeof t === 'string')
      : [],
    imageId: finite(body.imageId),
    imagePositionX: finite(body.imagePositionX) ?? 50,
    imagePositionY: finite(body.imagePositionY) ?? 50,
    isVolunteering: body.isVolunteering === true,
    isPaid: body.isPaid === true,
    priceCents: finite(body.priceCents),
  }
}

/**
 * The obec's admin takes an imported event over — founding it as the obec (lib/import/approve). With
 * the form's values ("Upravit a převzít") or, without a body, as the import found it.
 *
 * POST /api/import/candidates/:id/approve  [{ title, description, dateTime, … }] → { eventId }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  let edits: ApprovalInput | undefined
  if (body && Object.keys(body).length > 0) {
    const parsed = parseEdits(body)
    if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
    edits = parsed
  }

  try {
    const { eventId } = await approveCandidate(payload, user, id, edits, request)
    return NextResponse.json({ eventId })
  } catch (error) {
    return decisionErrorResponse(error, 'import.approve_failed', { candidateId: id })
  }
}
