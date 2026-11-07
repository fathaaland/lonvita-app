import type { Payload } from 'payload'

import { getMunicipalityAdminUserIds, sendNotificationToMany, escapeHtml } from '@/collections/shared/notify'

import { findSmsFields, smsUsageOf } from './sms'

const LEVELS = [100, 80] as const

/**
 * Balíčky služeb: "Při 80 % a 100 % čerpání dostane admin obce upozornění" — once per level and
 * licence year (Municipalities.smsAlertState remembers the last one sent). Run after every SMS the
 * worker sent; never throws.
 */
export async function checkSmsUsageAlerts(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<void> {
  try {
    const fields = await findSmsFields(payload, municipalityId)
    const usage = await smsUsageOf(payload, municipalityId, now, fields)
    if (usage.quota <= 0) return
    const percent = (usage.usedParts / usage.quota) * 100
    const level = LEVELS.find((l) => percent >= l)
    if (!level) return

    const [sentPeriod, sentLevel] = (fields.smsAlertState ?? '').split('|')
    if (sentPeriod === usage.period.key && Number(sentLevel) >= level) return

    await payload.update({
      collection: 'municipalities',
      id: municipalityId,
      data: { smsAlertState: `${usage.period.key}|${level}` },
      overrideAccess: true,
    })

    const adminIds = await getMunicipalityAdminUserIds(payload, municipalityId)
    const used = `${usage.usedParts} z ${usage.quota} SMS`
    const message =
      level === 100
        ? usage.overageAllowed
          ? `Roční kvóta SMS je vyčerpaná (${used}). SMS chodí dál jako přečerpání, které se vyúčtuje na konci roku.`
          : `Roční kvóta SMS je vyčerpaná (${used}). Do konce licenčního roku chodí upozornění jen e-mailem a v aplikaci. O navýšení balíčku si řekněte provozovateli Lonvity.`
        : `Obec vyčerpala 80 % roční kvóty SMS (${used}).`
    await sendNotificationToMany(payload, adminIds, {
      title: level === 100 ? 'Kvóta SMS je vyčerpaná' : 'Kvóta SMS se blíží limitu',
      message,
      link: '/admin-obce?tab=settings',
      email: {
        subject: level === 100 ? 'Lonvita: kvóta SMS je vyčerpaná' : 'Lonvita: 80 % kvóty SMS',
        body: `<p>${escapeHtml(message)}</p>`,
      },
    })
  } catch (error) {
    payload.logger.error({ err: error, municipalityId }, 'SMS usage alert check failed')
  }
}
