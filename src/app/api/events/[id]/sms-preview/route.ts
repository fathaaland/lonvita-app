import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { eventOrganizerIds } from '@/collections/Events'
import { getEventRegistrants } from '@/collections/shared/eventNotifications'
import { findSmsReachable } from '@/collections/shared/notify'
import { cancellationSmsText, planCancellationSms, smsAllowanceOf, smsPartsOf } from '@/lib/billing/sms'
import { smsPartsHeld } from '@/lib/billing/sms-reservations'
import { smsSentForCapacity } from '@/lib/capacity'
import { relationKey, relationNumber, requiredRelationNumber } from '@/lib/relations'

/**
 * What cancelling the event would text, as things stand — for the cancel dialog, so whoever cancels
 * sees up front whether the registrants who chose SMS get one. Only for whoever may cancel it: its
 * pořadatel, every spolupořadatel, an admin of its obec and a platform admin. How much of the obec's
 * quota is left is the obec's business: only its admins and the platform's see it. An estimate — the
 * real decision is made when the cancellation goes out (sendCancellationSms) and by the worker's ledger.
 *
 * GET /api/events/:id/sms-preview →
 *   { sms: false }  (no SMS for this event: the obec has none, is suspended, or the event is too big)
 *   { sms: true, wanted, texted }                       for the pořadatel
 *   { sms: true, wanted, texted, overage, remaining }  for an admin of the obec or the platform
 *     wanted    registrants who chose SMS and have a phone
 *     texted    of them, who'd get it (all of them, some up to the overage cap, or none once the quota is used up)
 *     overage   of those texted, past the quota (billed by the contract's terms)
 *     remaining SMS left in the obec's quota, less those already queued
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event || event.deletedAt) return NextResponse.json({ error: 'Akce neexistuje.' }, { status: 404 })

  const seesQuota =
    user.role === 'admin' ||
    (await getAdministeredMunicipalityIds(payload, user.id)).includes(relationKey(event.municipality))
  if (!seesQuota && !eventOrganizerIds(event).includes(String(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const municipalityId = relationNumber(event.municipality)
  if (municipalityId === null || !smsSentForCapacity(event.capacity)) return NextResponse.json({ sms: false })

  const allowance = await smsAllowanceOf(payload, municipalityId, new Date())
  if (!allowance.active) return NextResponse.json({ sms: false })

  const { userIds } = await getEventRegistrants(payload, event.id, requiredRelationNumber(event.organizer))
  const reachable = await findSmsReachable(payload, userIds)
  const parts = smsPartsOf(cancellationSmsText(event.title))
  const held = await smsPartsHeld(municipalityId)
  const plan = planCancellationSms(reachable, parts, allowance, held)
  const answer = { sms: true, wanted: reachable.length, texted: plan.length }
  if (!seesQuota) return NextResponse.json(answer)
  return NextResponse.json({
    ...answer,
    overage: plan.filter((r) => r.overage).length,
    remaining: Math.max(0, allowance.remainingParts - held),
  })
}
