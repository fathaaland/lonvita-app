import type { Payload } from 'payload'

import {
  escapeHtml,
  getMunicipalityAdminUserIds,
  sendNotificationToMany,
  type SmsOutcome,
} from '@/collections/shared/notify'
import { logger, serializeError } from '@/lib/logger'

/**
 * After a cancellation was announced: if the obec's SMS quota was already used up, so those who chose
 * SMS got none, its pořadatel and the obec's admins are told how many — so nobody assumes
 * everyone got a text. Those left out had the e-mail and the in-app notice all the same. Nothing
 * when everyone who wanted an SMS got one (overage included). Never throws.
 */
export async function reportSmsShortfall(
  payload: Payload,
  {
    municipalityId,
    organizerId,
    eventTitle,
    outcome,
    dedupPrefix,
  }: {
    municipalityId: number
    organizerId: number | string | null | undefined
    eventTitle: string
    outcome: SmsOutcome
    /** The announcement's id — a retry of it doesn't tell anyone twice. */
    dedupPrefix: string
  },
): Promise<void> {
  if (outcome.withheld <= 0) return
  try {
    const adminIds = await getMunicipalityAdminUserIds(payload, municipalityId)
    const userIds = [...new Set([...adminIds.map(String), ...(organizerId != null ? [String(organizerId)] : [])])]
    if (userIds.length === 0) return
    const got = outcome.wanted - outcome.withheld
    const what = 'o zrušení akce'
    const message =
      `SMS ${what} „${eventTitle}“ dostalo ${got} z ${outcome.wanted} lidí, kteří si SMS zvolili — ` +
      `roční kvóta SMS obce už byla vyčerpaná. Zbylých ${outcome.withheld} dostalo upozornění e-mailem a v aplikaci. O navýšení balíčku si řekněte provozovateli Lonvity.`
    await sendNotificationToMany(
      payload,
      userIds,
      {
        title: 'SMS nedošla všem',
        message,
        email: { subject: `Lonvita: SMS ${what} nedošla všem`, body: `<p>${escapeHtml(message)}</p>` },
      },
      { jobIdPrefix: `${dedupPrefix}-sms-shortfall` },
    )
  } catch (error) {
    logger.warn('SMS shortfall report not sent', {
      event: 'sms.shortfall_report_failed',
      municipalityId,
      ...serializeError(error),
    })
  }
}
