import type { Payload } from 'payload'

import { getMunicipalityAdminUserIds, sendNotificationToMany, escapeHtml } from '@/collections/shared/notify'

import { findSmsFields, smsUsageOf, type SmsUsage } from './sms'

/** Percent of the quota at which the obec's admins are told — past 100 by the overage of the cancellation that used it up. */
const LEVELS = [200, 150, 120, 100, 80] as const

const smsCount = (n: number) => `${n.toLocaleString('cs-CZ')} SMS`

/** What the admins read at `level` — always in SMS, not only in percent. */
export function smsAlertMessage(level: number, usage: SmsUsage): { title: string; message: string } {
  const used = `${smsCount(usage.usedParts)} z ${smsCount(usage.quota)}`
  if (level > 100) {
    return {
      title: 'Přečerpání SMS roste',
      message: `Obec poslala ${used} roční kvóty, přečerpání je ${smsCount(usage.overageParts)}. Vyúčtuje se na konci licenčního roku. O větší balíček si řekněte provozovateli Lonvity.`,
    }
  }
  if (level === 100) {
    return {
      title: 'Kvóta SMS je vyčerpaná',
      message: `Roční kvóta SMS je vyčerpaná (${used}). Další zrušení akcí už půjdou jen e-mailem a v aplikaci; SMS rozeslané přes kvótu se vyúčtují jako přečerpání. O navýšení balíčku si řekněte provozovateli Lonvity.`,
    }
  }
  const left = Math.max(0, usage.quota - usage.usedParts)
  return {
    title: 'Kvóta SMS se blíží limitu',
    message:
      `Obec vyčerpala ${level} % roční kvóty SMS (${used}), zbývá ${smsCount(left)}. ` +
      'Zrušení akce, které začne, dokud zbývá aspoň 1 SMS, se rozešle všem — přebytek se vyúčtuje jako přečerpání. Potom už SMS nechodí.',
  }
}

/**
 * Balíčky služeb: "Při 80 % a 100 % čerpání dostane admin obce upozornění" — once per level and
 * licence year (Municipalities.smsAlertState remembers the last one sent); also at 120, 150 and 200 %
 * — a small quota can be overshot that far by one cancellation, and the bill grows with it. Run after every SMS the worker sent and
 * every one it refused for the quota; never throws.
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
    const { title, message } = smsAlertMessage(level, usage)
    await sendNotificationToMany(payload, adminIds, {
      title,
      message,
      link: '/admin-obce?tab=settings',
      email: { subject: `Lonvita: ${title}`, body: `<p>${escapeHtml(message)}</p>` },
    })
  } catch (error) {
    payload.logger.error({ err: error, municipalityId }, 'SMS usage alert check failed')
  }
}
