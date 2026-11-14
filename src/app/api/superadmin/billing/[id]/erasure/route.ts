import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { writeAuditLog } from '@/collections/shared/auditLog'
import { billingStatusOf } from '@/lib/billing/status'
import { logger, serializeError } from '@/lib/logger'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/**
 * The platform's hand-given go-ahead to erase an obec for good (lib/billing/status-step): the daily job
 * never erases one on its own. Only a platform admin, only for an obec that is `terminated`, and only by
 * typing its exact name — the one path that sets `Municipalities.erasureConfirmedAt` (no generic update
 * can, whoever sends it). Withdrawn the same way; changing the obec's status withdraws it too.
 *
 * POST   /api/superadmin/billing/:id/erasure  { confirmName } → { confirmed: true }
 * DELETE /api/superadmin/billing/:id/erasure                  → { confirmed: false }
 */
async function authorize(request: Request, id: string) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const municipalityId = Number(id)
  if (!Number.isInteger(municipalityId) || municipalityId <= 0) {
    return { error: NextResponse.json({ error: 'Neplatná obec.' }, { status: 400 }) }
  }
  const obec = await payload
    .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!obec) return { error: NextResponse.json({ error: 'Obec neexistuje.' }, { status: 404 }) }
  return { payload, user, municipalityId, obec }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, (await context.params).id)
  if ('error' in auth) return auth.error
  const { payload, user, municipalityId, obec } = auth

  const limit = await consumeRateLimit({
    namespace: 'erasure-confirm',
    identifier: String(user.id),
    max: 10,
    windowSeconds: 60 * 60,
  })
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Moc pokusů, zkuste to později.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } })
  }

  const body = (await request.json().catch(() => null)) as { confirmName?: unknown } | null
  if (billingStatusOf(obec.billingStatus) !== 'terminated') {
    return NextResponse.json({ error: 'Smazání lze potvrdit jen u obce se skončenou smlouvou (stav Ukončeno).' }, { status: 409 })
  }
  if (typeof body?.confirmName !== 'string' || body.confirmName.trim() !== obec.name.trim()) {
    return NextResponse.json({ error: 'Opište přesný název obce.' }, { status: 400 })
  }

  // The stage being confirmed — what the confirmation is tied to, and holds for.
  const stage = obec.billingStatusChangedAt
  if (!stage) return NextResponse.json({ error: 'Obec nemá spuštěné hodiny — počkejte na noční běh.' }, { status: 409 })

  try {
    await payload.update({ collection: 'municipalities', id: municipalityId, data: { erasureConfirmedStage: stage }, overrideAccess: true })
    writeAuditLog(payload, {
      action: 'municipalities.erasure-confirm',
      actor: Number(user.id),
      targetCollection: 'municipalities',
      targetId: municipalityId,
      municipality: municipalityId,
      metadata: { name: obec.name },
      source: request,
    })
    logger.warn('Obec erasure confirmed', { event: 'billing.erasure_confirmed', municipalityId, userId: user.id })
    return NextResponse.json({ confirmed: true })
  } catch (error) {
    logger.error('Erasure confirmation failed', { event: 'billing.erasure_confirm_failed', municipalityId, ...serializeError(error) })
    return NextResponse.json({ error: 'Potvrzení se nepodařilo uložit.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, (await context.params).id)
  if ('error' in auth) return auth.error
  const { payload, user, municipalityId, obec } = auth
  try {
    await payload.update({ collection: 'municipalities', id: municipalityId, data: { erasureConfirmedStage: null }, overrideAccess: true })
    writeAuditLog(payload, {
      action: 'municipalities.erasure-withdraw',
      actor: Number(user.id),
      targetCollection: 'municipalities',
      targetId: municipalityId,
      municipality: municipalityId,
      metadata: { name: obec.name },
      source: request,
    })
    return NextResponse.json({ confirmed: false })
  } catch (error) {
    logger.error('Erasure withdrawal failed', { event: 'billing.erasure_withdraw_failed', municipalityId, ...serializeError(error) })
    return NextResponse.json({ error: 'Potvrzení se nepodařilo zrušit.' }, { status: 500 })
  }
}
