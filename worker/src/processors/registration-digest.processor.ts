import { sendNotificationToMany } from '@/collections/shared/notify'
import { logger } from '@/lib/logger'
import {
  clearRegistrationDigest,
  digestEmail,
  readRegistrationDigest,
  registrationDigestJobId,
} from '@/lib/notifications/registration-digest'

import { getWorkerPayload } from '../runtime/payload'

import type { RegistrationDigestJobData, RegistrationDigestJobResult } from '@/lib/queue/contracts'

/**
 * One e-mail per recipient about the registrations of a closed window (lib/notifications/
 * registration-digest). A registration cancelled or rejected since isn't mentioned any more; an
 * event cancelled since sends nothing. Retry-safe: the e-mail job ids are the digest's, and the
 * entries are cleared only once everything is queued.
 */
export const processRegistrationDigestJob = async ({
  eventId,
  windowStart,
}: RegistrationDigestJobData): Promise<RegistrationDigestJobResult> => {
  const payload = await getWorkerPayload()
  const byRecipient = await readRegistrationDigest(eventId, windowStart)
  const recipientIds = [...byRecipient.keys()]
  const result: RegistrationDigestJobResult = { recipients: 0, registrations: 0, emails: 0 }
  if (recipientIds.length === 0) return result

  const event = await payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true, select: { title: true, status: true, deletedAt: true } })
    .catch(() => null)

  if (event && !event.deletedAt && event.status !== 'cancelled') {
    const registrationIds = [...new Set([...byRecipient.values()].flat().map((e) => String(e.registrationId)))]
    const active = await payload.find({
      collection: 'registrations',
      where: {
        and: [
          { id: { in: registrationIds } },
          { status: { in: ['pending', 'approved'] } },
          { deletedAt: { exists: false } },
        ],
      },
      select: { status: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const statusOf = new Map(active.docs.map((r) => [String(r.id), r.status]))
    result.registrations = statusOf.size

    for (const [recipientId, entries] of byRecipient) {
      const still = entries
        .filter((e) => statusOf.has(String(e.registrationId)))
        // Approved in the meantime — nothing waits on the recipient any more.
        .map((e) => (statusOf.get(String(e.registrationId)) === 'pending' ? e : { ...e, awaiting: undefined }))
      if (still.length === 0) continue
      result.recipients++
      const sent = await sendNotificationToMany(
        payload,
        [recipientId],
        { title: 'Nové přihlášky na akci', message: '', email: digestEmail(event.title, still) },
        { inApp: false, jobIdPrefix: registrationDigestJobId(eventId, windowStart) },
      )
      result.emails += sent.emails
    }
  }

  await clearRegistrationDigest(eventId, windowStart, recipientIds)
  logger.info('Registration digest sent', { event: 'notifications.registration_digest_sent', eventId, windowStart, ...result })
  return result
}
