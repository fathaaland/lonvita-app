import type { Payload } from 'payload'

import { escapeHtml, getMunicipalityAdminUserIds, sendNotificationToMany } from '@/collections/shared/notify'
import { logger, serializeError } from '@/lib/logger'
import type { BillingStatusJobResult } from '@/lib/queue/contracts'

import { WARN_DAYS_BEFORE, nextBillingStepAt } from './status'

const DAY_MS = 24 * 60 * 60 * 1000
const pragueDate = (d: Date) => d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })

/**
 * Daily: every suspended obec past its grace period becomes read-only (the Municipalities hook tells
 * its admins and restarts the clock); one within WARN_DAYS_BEFORE of it is warned, once per
 * suspension. A suspension without a clock (set before it existed) starts it now. One obec failing
 * doesn't stop the others.
 */
export async function advanceBillingStatuses(payload: Payload, now: Date = new Date()): Promise<BillingStatusJobResult> {
  const result: BillingStatusJobResult = { warned: 0, madeReadOnly: 0, clockStarted: 0, failed: 0 }
  const suspended = await payload.find({
    collection: 'municipalities',
    where: { billingStatus: { equals: 'suspended' } },
    select: { billingStatus: true, billingStatusChangedAt: true, billingWarnedAt: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  for (const m of suspended.docs) {
    try {
      if (!m.billingStatusChangedAt) {
        await payload.update({
          collection: 'municipalities',
          id: m.id,
          data: { billingStatusChangedAt: now.toISOString() },
          overrideAccess: true,
        })
        result.clockStarted++
        continue
      }
      const readOnlyAt = nextBillingStepAt('suspended', m.billingStatusChangedAt)!
      if (now >= readOnlyAt) {
        await payload.update({ collection: 'municipalities', id: m.id, data: { billingStatus: 'read_only' }, overrideAccess: true })
        result.madeReadOnly++
        continue
      }
      const warnedThisTime = m.billingWarnedAt && new Date(m.billingWarnedAt) >= new Date(m.billingStatusChangedAt)
      if (!warnedThisTime && readOnlyAt.getTime() - now.getTime() <= WARN_DAYS_BEFORE * DAY_MS) {
        await payload.update({
          collection: 'municipalities',
          id: m.id,
          data: { billingWarnedAt: now.toISOString() },
          overrideAccess: true,
        })
        const title = 'Obec brzy přejde do režimu jen pro čtení'
        const message =
          `Licence obce je stále pozastavená. Pokud ji neobnovíte do ${pragueDate(readOnlyAt)}, obec přejde do režimu jen pro čtení: ` +
          'nepůjde zakládat ani upravovat akce, zvát dobrovolníky ani přijímat pořadatele. Přihlášky na zveřejněné akce a jejich rušení poběží dál. ' +
          'Obnovu licence vyřídí provozovatel Lonvity.'
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
