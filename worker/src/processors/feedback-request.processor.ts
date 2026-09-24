import { escapeHtml, sendNotification } from '@/collections/shared/notify'
import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { FeedbackRequestJobData, FeedbackRequestJobResult } from '@/lib/queue/contracts'

const relId = (value: unknown): number | string =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

/** Where the notification opens — "Moje akce" with this registration's rating dialog already up
 * (the `hodnotit` param is read by moje-akce/page.tsx). */
const feedbackLink = (registrationId: number | string) => `/moje-akce?hodnotit=${registrationId}`

/**
 * Sends the "ohodnoťte akci" prompt scheduled by `scheduleFeedbackRequest` — unless, by the time it
 * fires, there's no longer anything to ask: attendance was changed, the event was cancelled or
 * moved later (a fresh job exists for the new time), feedback was already left from the profile,
 * or this exact prompt already went out (the organizer toggled attendance off and back on).
 */
export const processFeedbackRequestJob = async (data: FeedbackRequestJobData): Promise<FeedbackRequestJobResult> => {
  const payload = await getWorkerPayload()
  const skip = (reason: string): FeedbackRequestJobResult => {
    logger.info('Feedback request skipped', { event: 'feedback_request.skipped', registrationId: data.registrationId, reason })
    return { sent: false, skipped: reason }
  }

  const registration = await payload
    .findByID({ collection: 'registrations', id: data.registrationId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!registration || registration.deletedAt) return skip('registration_missing')
  if (registration.status !== 'approved' || registration.attendanceStatus !== 'attended') return skip('not_attended')

  const event = await payload
    .findByID({
      collection: 'events',
      id: relId(registration.event),
      depth: 0,
      overrideAccess: true,
      // Only reading — no reason to also persist the derived 'finished' status from here.
      context: { skipFinishedAutoUpdate: true },
    })
    .catch(() => null)
  if (!event || event.deletedAt || event.status === 'cancelled') return skip('event_gone')
  if (new Date(event.endDateTime ?? event.dateTime).getTime() > Date.now()) return skip('event_not_over')

  const userId = relId(registration.user)
  const link = feedbackLink(registration.id)
  const [feedback, alreadyAsked] = await Promise.all([
    payload.count({ collection: 'event-feedback', where: { registration: { equals: registration.id } }, overrideAccess: true }),
    payload.count({
      collection: 'notifications',
      where: { and: [{ user: { equals: userId } }, { link: { equals: link } }] },
      overrideAccess: true,
    }),
  ])
  if (feedback.totalDocs > 0) return skip('already_rated')
  if (alreadyAsked.totalDocs > 0) return skip('already_asked')

  const title = escapeHtml(event.title)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  await sendNotification(payload, {
    userId,
    title: 'Jak se vám akce líbila?',
    message: `Ohodnoťte akci „${event.title}“ — pořadateli to pomůže připravit další.`,
    link,
    email: {
      subject: `Jak se vám líbila akce ${event.title}?`,
      body:
        `<p>Děkujeme, že jste přišli na akci <strong>${title}</strong>. Ohodnoťte ji prosím — zabere to minutu a pořadateli to pomůže připravit další.</p>` +
        (appUrl ? `<p><a href="${appUrl}${link}">Ohodnotit akci</a></p>` : ''),
    },
  })

  logger.info('Feedback request sent', { event: 'feedback_request.sent', registrationId: registration.id })
  return { sent: true }
}
