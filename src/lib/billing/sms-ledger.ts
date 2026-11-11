import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Payload } from 'payload'

import { lockRow } from '@/lib/db-lock'
import { logger, serializeError } from '@/lib/logger'

import { getBillingCatalog } from './catalog'
import { licencePeriodOf } from './period'
import { countSmsParts, smsQuotaOf } from './sms'

/**
 * The worker's last word on every SMS of an obec, right before it goes to BulkGate — what the quota
 * and the invoice rest on, whatever happened when it was queued (the quota lock in sms-reservations
 * timed out, or Redis was away). Under the obec's row lock it counts what the obec has really sent
 * this licence year and either refuses (no SMS package, suspended, quota used up with no overage) or
 * writes the SMS to the ledger (sms-messages) up front, marked as overage when it no longer fits the
 * quota. Written before sending, so a send whose record would fail afterwards can't go uncounted; a
 * send that then fails takes its row back out (dropSmsClaim).
 */
export type SmsClaim =
  | { decision: 'send'; rowId: number; overage: boolean }
  | { decision: 'skip'; reason: 'no_sms' | 'suspended' | 'quota_used_up' }

export async function claimSmsParts(
  payload: Payload,
  { municipalityId, requestId, parts, now = new Date() }: { municipalityId: number; requestId?: string; parts: number; now?: Date },
): Promise<SmsClaim> {
  const req = await createLocalReq({}, payload)
  const shouldCommit = await initTransaction(req)
  try {
    // One obec's SMS decided one at a time — two counting at once would each see the other's as unsent.
    if (!(await lockRow(req, 'municipalities', municipalityId))) {
      throw new Error('SMS quota: no transaction to lock the obec in')
    }
    // A retry of the same request (an earlier attempt recorded it, then failed before marking it
    // sent) keeps its row — counted once.
    if (requestId) {
      const existing = await payload.find({
        collection: 'sms-messages',
        where: { and: [{ requestId: { equals: requestId } }, { municipality: { equals: municipalityId } }] },
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
      })
      const row = existing.docs[0]
      if (row) {
        if (shouldCommit) await commitTransaction(req)
        return { decision: 'send', rowId: row.id, overage: row.overage === true }
      }
    }
    const obec = await payload.findByID({
      collection: 'municipalities',
      id: municipalityId,
      depth: 0,
      overrideAccess: true,
      req,
      select: {
        smsEnabled: true,
        billingStatus: true,
        smsPackage: true,
        smsQuotaOverride: true,
        smsOverageAllowed: true,
        licencePeriodStart: true,
        licencePeriodEnd: true,
      },
    })
    let refusal: Extract<SmsClaim, { decision: 'skip' }>['reason'] | null = null
    let overage = false
    if (obec.billingStatus === 'suspended') refusal = 'suspended'
    else if (obec.smsEnabled !== true) refusal = 'no_sms'
    else {
      const period = licencePeriodOf(obec, now)
      // Counted after the lock is held: every earlier claim of this obec has committed by then.
      const used = await countSmsParts(payload, municipalityId, period.start, period.end, req)
      overage = used.parts + parts > smsQuotaOf(obec, await getBillingCatalog(payload, req))
      if (overage && obec.smsOverageAllowed !== true) refusal = 'quota_used_up'
    }
    if (refusal) {
      if (shouldCommit) await commitTransaction(req)
      return { decision: 'skip', reason: refusal }
    }
    const row = await payload.create({
      collection: 'sms-messages',
      data: { municipality: municipalityId, requestId, parts, overage },
      overrideAccess: true,
      req,
    })
    if (shouldCommit) await commitTransaction(req)
    return { decision: 'send', rowId: row.id, overage }
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    throw error
  }
}

/** The SMS went out — BulkGate's id on its row. Only a detail: the row already counts. */
export async function confirmSmsClaim(payload: Payload, rowId: number, providerMessageSid?: string): Promise<void> {
  if (!providerMessageSid) return
  await payload
    .update({ collection: 'sms-messages', id: rowId, data: { providerMessageSid }, overrideAccess: true })
    .catch((error) => logger.warn('SMS provider id not stored', { event: 'sms.sid_not_stored', rowId, ...serializeError(error) }))
}

/** The SMS didn't go out — its row comes off the ledger, or the obec would pay for it. A row that
 * can't be taken off is an invoice that's wrong: the platform hears it (lib/alerts/ops). */
export async function dropSmsClaim(payload: Payload, rowId: number, requestId?: string): Promise<void> {
  try {
    await payload.delete({ collection: 'sms-messages', id: rowId, overrideAccess: true })
  } catch (error) {
    logger.error('SMS ledger row of an unsent SMS not removed — the obec would be billed for it', {
      event: 'sms.ledger_failed',
      rowId,
      requestId,
      ...serializeError(error),
    })
  }
}
