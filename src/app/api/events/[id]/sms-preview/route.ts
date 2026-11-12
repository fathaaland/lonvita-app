import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { eventOrganizerIds } from '@/collections/Events'
import { cancellationSmsText, getEventRegistrants } from '@/collections/shared/eventNotifications'
import { findSmsReachable } from '@/collections/shared/notify'
import { planSmsRecipients, smsAllowanceOf, smsPartsOf, toSmsText } from '@/lib/billing/sms'
import { smsPartsHeld } from '@/lib/billing/sms-reservations'
import { smsSentForCapacity } from '@/lib/capacity'
import { relationKey, relationNumber, requiredRelationNumber } from '@/lib/relations'

/**
 * What cancelling the event would text, as things stand — for the cancel dialog, so whoever cancels
 * sees up front when the obec's SMS quota won't reach everyone. Only for whoever may cancel it: its
 * pořadatel, every spolupořadatel, an admin of its obec and a platform admin. An estimate: the real
 * decision is made when the cancellation goes out (sendSmsToMany) and by the worker's ledger.
 *
 * GET /api/events/:id/sms-preview →
 *   { sms: false }  (no SMS for this event: the obec has none, is suspended, or the event is too big)
 *   { sms: true, wanted, texted, overage, remaining, overageAllowed }
 *     wanted    registrants who chose SMS and have a phone
 *     texted    of them, within the quota
 *     overage   of them, past the quota (only where the obec allows overage)
 *     remaining SMS left in the obec's quota, less those already queued
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event || event.deletedAt) return NextResponse.json({ error: 'Akce neexistuje.' }, { status: 404 })

  const runsIt =
    user.role === 'admin' ||
    eventOrganizerIds(event).includes(String(user.id)) ||
    (await getAdministeredMunicipalityIds(payload, user.id)).includes(relationKey(event.municipality))
  if (!runsIt) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const municipalityId = relationNumber(event.municipality)
  if (municipalityId === null || !smsSentForCapacity(event.capacity)) return NextResponse.json({ sms: false })

  const allowance = await smsAllowanceOf(payload, municipalityId, new Date())
  if (!allowance.active) return NextResponse.json({ sms: false })

  const { userIds } = await getEventRegistrants(payload, event.id, requiredRelationNumber(event.organizer))
  const reachable = await findSmsReachable(payload, userIds)
  const parts = smsPartsOf(toSmsText(cancellationSmsText(event.title)))
  const held = await smsPartsHeld(municipalityId)
  const plan = planSmsRecipients(reachable, parts, allowance, held, 'announcement')
  return NextResponse.json({
    sms: true,
    wanted: reachable.length,
    texted: plan.filter((r) => !r.overage).length,
    overage: plan.filter((r) => r.overage).length,
    remaining: Math.max(0, allowance.remainingParts - held),
    overageAllowed: allowance.overageAllowed,
  })
}
