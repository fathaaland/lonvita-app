import { sendSmsToMany } from '@/collections/shared/notify'
import { smsSentForCapacity } from '@/lib/capacity'
import { formatPragueDateTime } from '@/lib/date'
import { logger } from '@/lib/logger'
import { relationNumber } from '@/lib/relations'

import { getWorkerPayload } from '../runtime/payload'

import type { ReminderSmsJobData, ReminderSmsJobResult } from '@/lib/queue/contracts'

/**
 * The day-before reminder by SMS (Balíčky služeb: "připomínka den před akcí"), scheduled next to the
 * e-mail one (scheduleParticipantReminder). Checked again when it fires: the registration still
 * approved, the event still on and smaller than SMS_LARGE_EVENT_CAPACITY. sendSmsToMany then checks
 * the participant still wants SMS and the obec's package and quota.
 */
export const processReminderSmsJob = async (data: ReminderSmsJobData): Promise<ReminderSmsJobResult> => {
  const payload = await getWorkerPayload()
  const skip = (reason: string): ReminderSmsJobResult => {
    logger.info('Reminder SMS skipped', { event: 'reminder_sms.skipped', registrationId: data.registrationId, reason })
    return { sent: 0, skipped: reason }
  }

  const registration = await payload
    .findByID({ collection: 'registrations', id: data.registrationId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!registration || registration.status !== 'approved') return skip('not_approved')
  const eventId = relationNumber(registration.event)
  const userId = relationNumber(registration.user)
  if (eventId === null || userId === null) return skip('registration_incomplete')

  const event = await payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') return skip('event_gone')
  if (new Date(event.dateTime).getTime() <= Date.now()) return skip('event_started')
  if (!smsSentForCapacity(event.capacity)) return skip('large_event')
  const municipalityId = relationNumber(event.municipality)
  if (municipalityId === null) return skip('no_municipality')

  const sent = await sendSmsToMany(
    payload,
    municipalityId,
    [userId],
    `Lonvita: zítra vás čeká akce „${event.title}“ — ${formatPragueDateTime(event.dateTime)}, ${event.locationText}.`,
    `reminder-${registration.id}-${new Date(event.dateTime).getTime()}`,
    // Leaves the quota's reserve for cancellations and changes alone (lib/billing/sms).
    { purpose: 'reminder' },
  )
  logger.info('Reminder SMS', {
    event: 'reminder_sms.done',
    registrationId: registration.id,
    sent: sent.queued,
    withheld: sent.withheld,
  })
  return { sent: sent.queued, ...(sent.withheld > 0 ? { skipped: 'quota_reserved' } : {}) }
}
