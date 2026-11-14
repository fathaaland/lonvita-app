import type { Payload } from 'payload'

import { getMunicipalityAdminUserIds, sendNotificationToMany, escapeHtml } from '@/collections/shared/notify'

import { findSmsFields, smsUsageOf, type SmsUsage } from './sms'

/** Percent of the quota at which the obec's admins are told — and always where its overage cap is. */
const MILESTONES = [80, 100, 120, 150, 200] as const

/** The levels in force for a cap of `capPercent` % over the quota: the milestones up to it, and the cap itself. */
export const alertLevelsFor = (capPercent: number): number[] => {
  const capLevel = 100 + Math.max(0, capPercent)
  return [...new Set([...MILESTONES.filter((l) => l < capLevel), capLevel])].sort((a, b) => b - a)
}

const smsCount = (n: number) => `${n.toLocaleString('cs-CZ')} SMS`

/** What the admins read at `level` — always in SMS, not only in percent. */
export function smsAlertMessage(level: number, usage: SmsUsage): { title: string; message: string } {
  const used = `${smsCount(usage.usedParts)} z ${smsCount(usage.quota)}`
  const extra = Math.max(0, usage.hardLimit - usage.quota)
  const capLevel = usage.quota > 0 ? Math.round((usage.hardLimit / usage.quota) * 100) : 100
  if (level >= capLevel && level > 100) {
    return {
      title: 'Strop přečerpání SMS je vyčerpaný',
      message:
        `Obec poslala ${used} roční kvóty a dosáhla stropu přečerpání (${smsCount(usage.hardLimit)}, tj. ${smsCount(extra)} nad kvótu). ` +
        'Další SMS o zrušení akcí už nepůjdou, lidé se to dozvědí jen e-mailem a v aplikaci. Přečerpání se vyúčtuje na konci licenčního roku. O větší balíček si řekněte provozovateli Lonvity.',
    }
  }
  if (level > 100) {
    return {
      title: 'Přečerpání SMS roste',
      message: `Obec poslala ${used} roční kvóty, přečerpání je ${smsCount(usage.overageParts)} (strop ${smsCount(extra)}). Vyúčtuje se na konci licenčního roku. O větší balíček si řekněte provozovateli Lonvity.`,
    }
  }
  if (level === 100) {
    return {
      title: 'Kvóta SMS je vyčerpaná',
      message:
        `Roční kvóta SMS je vyčerpaná (${used}). Další zrušení akcí už půjdou jen e-mailem a v aplikaci` +
        (extra > 0
          ? `; SMS rozeslané přes kvótu se vyúčtují jako přečerpání, nejvýš do ${smsCount(extra)} nad kvótu. `
          : ' (přečerpání kvóty není povoleno). ') +
        'O navýšení balíčku si řekněte provozovateli Lonvity.',
    }
  }
  const left = Math.max(0, usage.quota - usage.usedParts)
  return {
    title: 'Kvóta SMS se blíží limitu',
    message:
      `Obec vyčerpala ${level} % roční kvóty SMS (${used}), zbývá ${smsCount(left)}. ` +
      (extra > 0
        ? `Zrušení akce, které začne, dokud zbývá aspoň 1 SMS, se rozešle až do stropu přečerpání (${smsCount(extra)} nad kvótu), přebytek se vyúčtuje. Potom už SMS nechodí.`
        : 'Zrušení akce, které začne, dokud zbývá aspoň 1 SMS, se rozešle do vyčerpání kvóty. Potom už SMS nechodí.'),
  }
}

/**
 * Balíčky služeb: "Při 80 % a 100 % čerpání dostane admin obce upozornění" — once per level and
 * licence year (Municipalities.smsAlertState remembers the last one sent); also at 120, 150 and 200 %
 * while the overage cap allows it, and where the cap is — the last one: nothing more is texted past it. Run after every SMS the worker sent and
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
    const level = alertLevelsFor(Math.round((usage.hardLimit / usage.quota - 1) * 100)).find((l) => percent >= l)
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
