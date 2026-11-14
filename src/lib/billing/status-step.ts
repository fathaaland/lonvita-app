import type { Payload } from 'payload'

import { recordAuditLog } from '@/collections/shared/auditLog'
import { escapeHtml, getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { notDeleted } from '@/collections/shared/softDelete'
import { canCancelEvent } from '@/lib/eventCancellation'
import { logger, serializeError } from '@/lib/logger'
import type { BillingStatusJobResult } from '@/lib/queue/contracts'

import { WARN_DAYS_BEFORE, billingStatusOf, erasureConfirmed, nextBillingStepAt, type BillingStatus } from './status'

const DAY_MS = 24 * 60 * 60 * 1000
const pragueDate = (d: Date) => d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })

type Stage = Exclude<BillingStatus, 'active'>

/** What the admins read a week before each stage ends. */
const WARNINGS: Record<Stage, (at: Date) => { title: string; message: string }> = {
  suspended: (at) => ({
    title: 'Obec brzy přejde do režimu jen pro čtení',
    message:
      `Licence obce je stále pozastavená. Pokud ji neobnovíte do ${pragueDate(at)}, obec přejde do režimu jen pro čtení: ` +
      'nepůjde zakládat ani upravovat akce, zvát dobrovolníky ani přijímat pořadatele. Přihlášky na zveřejněné akce a jejich rušení poběží dál. ' +
      'Obnovu licence vyřídí provozovatel Lonvity.',
  }),
  read_only: (at) => ({
    title: 'Smlouva obce brzy skončí',
    message:
      `Obec je kvůli nezaplacené licenci v režimu jen pro čtení. Pokud ji neobnovíte do ${pragueDate(at)}, smlouva skončí ` +
      'a po další lhůtě se údaje obce smažou. Všechna data obce si můžete kdykoli stáhnout v Nastavení. Obnovu vyřídí provozovatel Lonvity.',
  }),
  terminated: (at) => ({
    title: 'Údaje obce se za týden smažou',
    message:
      `Nejdříve ${pragueDate(at)} se smažou všechny údaje obce v Lonvitě — akce, přihlášky, organizace i role — a obnovit je nepůjde. ` +
      'Pokud jste to ještě neudělali, stáhněte si data obce v Nastavení. Akce, které by se konaly později, jsme zrušili a přihlášené zpravili. ' +
      'Účty obyvatel zůstávají.',
  }),
}

const NEXT: Record<Exclude<Stage, 'terminated'>, BillingStatus> = { suspended: 'read_only', read_only: 'terminated' }

/**
 * Cancels the obec's events that would take place at or after `after` — the obec won't be there to
 * run them. Through the usual cancellation (the registrants are told, by e-mail and in the app); one
 * starting within the cancellation cut-off can't be, and is counted as left.
 */
async function cancelEventsFrom(payload: Payload, municipalityId: number, after: Date): Promise<{ cancelled: number; left: number }> {
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { status: { not_equals: 'cancelled' } },
        notDeleted,
        { dateTime: { greater_than_equal: after.toISOString() } },
      ],
    },
    select: { dateTime: true, isDraft: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  let cancelled = 0
  let left = 0
  for (const event of events.docs) {
    if (!canCancelEvent(event.dateTime)) {
      left++
      continue
    }
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { status: 'cancelled', deletedAt: new Date().toISOString() },
      overrideAccess: true,
    })
    cancelled++
  }
  return { cancelled, left }
}

/**
 * What deleting an obec alone would leave behind (their rows outlive it, the obec emptied): its SMS
 * and AI usage records, and the files its admins exported (expired now — the nightly cleanup-exports
 * drops each from S3, then its row). When the contract ends, nothing of the obec stays. The audit log
 * does — kept by law (vyhláška č. 409/2025 Sb.), and the erasure itself is in it.
 */
export async function eraseObecLeftovers(payload: Payload, municipalityId: number): Promise<void> {
  // Never let a bad id widen the delete: an undefined `equals` is dropped from a where, and a bulk
  // delete without its condition takes every obec's rows.
  if (typeof municipalityId !== 'number' || !Number.isInteger(municipalityId) || municipalityId <= 0) {
    throw new Error(`eraseObecLeftovers: not an obec id: ${String(municipalityId)}`)
  }
  const ofObec = { municipality: { equals: municipalityId } }
  await payload.delete({ collection: 'sms-messages', where: ofObec, overrideAccess: true })
  await payload.delete({ collection: 'usage-events', where: ofObec, overrideAccess: true })
  const exports = await payload.find({
    collection: 'exports',
    where: { kind: { in: ['community-report', 'municipality-events', 'municipality-archive'] } },
    select: { params: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const ids = exports.docs
    .filter((e) => String((e.params as { municipalityId?: unknown } | null)?.municipalityId) === String(municipalityId))
    .map((e) => e.id)
  if (ids.length > 0) {
    await payload.update({
      collection: 'exports',
      where: { id: { in: ids } },
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    })
  }
}

/**
 * The contract ended and its period ran out: everything of the obec goes (Municipalities
 * deleteMunicipalityData and eraseObecLeftovers), its residents keep their accounts "bez obce". Put
 * on the record first — a restore from backup must erase it again (lib/retention/replay-anonymizations).
 */
async function eraseObec(payload: Payload, municipalityId: number, name: string): Promise<'erased' | 'postponed'> {
  const { left } = await cancelEventsFrom(payload, municipalityId, new Date())
  // One about to start can't be cancelled any more — it takes place, and the obec goes tomorrow.
  if (left > 0) return 'postponed'
  await recordAuditLog(payload, {
    action: 'municipalities.erase',
    actor: null,
    targetCollection: 'municipalities',
    targetId: municipalityId,
    municipality: null,
    metadata: { name, reason: 'contract-ended' },
  })
  await eraseObecLeftovers(payload, municipalityId)
  await payload.delete({ collection: 'municipalities', id: municipalityId, overrideAccess: true })
  return 'erased'
}

/**
 * Daily: each obec whose stage ran out moves on — suspended → read-only → terminated → erased (the
 * Municipalities hook tells its admins and restarts the clock); one within WARN_DAYS_BEFORE of it is
 * warned, once per stage, and a terminated one's later events are cancelled then. A stage without a
 * clock (set before it existed) starts it now. One obec failing doesn't stop the others.
 */
export async function advanceBillingStatuses(payload: Payload, now: Date = new Date()): Promise<BillingStatusJobResult> {
  const result: BillingStatusJobResult = { warned: 0, madeReadOnly: 0, terminated: 0, erased: 0, awaitingConfirmation: 0, eventsCancelled: 0, clockStarted: 0, failed: 0 }
  const obce = await payload.find({
    collection: 'municipalities',
    where: { billingStatus: { in: ['suspended', 'read_only', 'terminated'] } },
    select: { name: true, billingStatus: true, billingStatusChangedAt: true, billingWarnedAt: true, erasureConfirmedStage: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  for (const m of obce.docs) {
    const stage = billingStatusOf(m.billingStatus) as Stage
    try {
      if (!m.billingStatusChangedAt) {
        await payload.update({ collection: 'municipalities', id: m.id, data: { billingStatusChangedAt: now.toISOString() }, overrideAccess: true })
        result.clockStarted++
        continue
      }
      const stepAt = nextBillingStepAt(stage, m.billingStatusChangedAt)!
      if (now >= stepAt) {
        if (stage === 'terminated') {
          // Irreversible, so never on the clock alone: the platform confirms each erasure by hand
          // (POST /api/superadmin/billing/:id/erasure). Until then the obec stays as it is, and the
          // platform is reminded every day.
          if (!erasureConfirmed(m.billingStatus, m.billingStatusChangedAt, m.erasureConfirmedStage)) {
            result.awaitingConfirmation++
            logger.warn('Obec is due for erasure and waits for confirmation', {
              event: 'billing.erasure_unconfirmed',
              municipalityId: m.id,
            })
            continue
          }
          if ((await eraseObec(payload, m.id, m.name)) === 'erased') {
            result.erased++
            logger.warn('Obec erased after its contract ended', { event: 'billing.obec_erased', municipalityId: m.id })
          }
          continue
        }
        await payload.update({ collection: 'municipalities', id: m.id, data: { billingStatus: NEXT[stage] }, overrideAccess: true })
        if (NEXT[stage] === 'read_only') result.madeReadOnly++
        else result.terminated++
        continue
      }
      const warnedThisStage = m.billingWarnedAt && new Date(m.billingWarnedAt) >= new Date(m.billingStatusChangedAt)
      if (!warnedThisStage && stepAt.getTime() - now.getTime() <= WARN_DAYS_BEFORE * DAY_MS) {
        await payload.update({ collection: 'municipalities', id: m.id, data: { billingWarnedAt: now.toISOString() }, overrideAccess: true })
        if (stage === 'terminated') {
          result.eventsCancelled += (await cancelEventsFrom(payload, m.id, stepAt)).cancelled
          logger.warn('Obec is to be erased in a week — confirm it, or set it active again', {
            event: 'billing.erasure_imminent',
            municipalityId: m.id,
            erasedAt: stepAt.toISOString(),
          })
        }
        const { title, message } = WARNINGS[stage](stepAt)
        await sendNotificationToMany(payload, await getMunicipalityAdminUserIds(payload, m.id), {
          title,
          message,
          link: '/admin-obce?tab=settings',
          email: { subject: `Lonvita: ${title}`, body: `<p>${escapeHtml(message)}</p>` },
        })
        result.warned++
      }
    } catch (error) {
      result.failed++
      logger.error('Billing status step failed', { event: 'billing.status_step_failed', municipalityId: m.id, ...serializeError(error) })
    }
  }
  logger.info('Billing statuses advanced', { event: 'billing.status_stepped', ...result })
  return result
}
