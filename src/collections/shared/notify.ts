import type { Payload } from 'payload'

import { enqueueEmail, enqueueSms } from '@/lib/queue/queues'

/** Fire-and-forget in-app notification — a failed write must never block the operation
 * that triggered it (matches the pattern already used for audit-log writes). Used directly
 * only where the caller already knows the user wants an in-app notification regardless of
 * preference (e.g. nothing reads Profiles yet); prefer `sendNotification` otherwise. */
export const notify = (
  payload: Payload,
  input: { user: number; title: string; message: string; link?: string },
): void => {
  payload
    .create({
      collection: 'notifications',
      data: { user: input.user, title: input.title, message: input.message, link: input.link },
      overrideAccess: true,
    })
    .catch((error) => payload.logger.error({ err: error, user: input.user }, 'Failed to write notification'))
}

/** IDs of users holding "municipality_admin" for the given municipality — the audience for
 * "new organizer/volunteering request" notifications (brief §7 notification table). */
export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const getMunicipalityAdminUserIds = async (payload: Payload, municipalityId: number | string): Promise<number[]> => {
  const result = await payload.find({
    collection: 'user-roles',
    where: { and: [{ municipality: { equals: municipalityId } }, { role: { equals: 'municipality_admin' } }] },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })
  return result.docs.map((doc) => (typeof doc.user === 'object' ? doc.user.id : doc.user))
}

type NotificationContent = {
  title: string
  message: string
  /** In-app route the notification opens when clicked (e.g. the event detail). */
  link?: string
  /** Omit to send in-app only (no email content to send). */
  email?: { subject: string; body: string }
}

type SendNotificationInput = NotificationContent & { userId: number | string }

/**
 * Brief §7 "Preferovaný kanál notifikací (e-mail vs. v aplikaci), nastavitelný uživatelem" —
 * the one place that should send a user-facing notification, so every trigger respects the
 * same two independent preferences (Profiles.notifyEmail / notifyInApp, both default true).
 * Fire-and-forget throughout: a failed send must never block the write that triggered it.
 */
export async function sendNotification(payload: Payload, input: SendNotificationInput): Promise<void> {
  const { userId, ...content } = input
  await sendNotificationToMany(payload, [userId], content)
}

/** In-app writes in flight at once — enough to be quick, few enough not to hog the DB pool. */
const NOTIFICATION_WRITE_CONCURRENCY = 10

/**
 * `sendNotification` for a whole audience (e.g. an event's registrants) — the same message and
 * preferences, but two lookups for everyone instead of two per user. Never throws; a failure for
 * one user is logged and the rest still get theirs. `jobIdPrefix` makes the e-mail jobs
 * idempotent, for callers that may run twice (a worker job retried after a crash).
 */
export async function sendNotificationToMany(
  payload: Payload,
  userIds: (number | string)[],
  content: NotificationContent,
  options?: { jobIdPrefix?: string },
): Promise<{ inApp: number; emails: number }> {
  const sent = { inApp: 0, emails: 0 }
  const ids = [...new Set(userIds.map(String))]
  if (ids.length === 0) return sent

  try {
    const [profiles, users] = await Promise.all([
      payload.find({
        collection: 'profiles',
        where: { user: { in: ids } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'users',
        where: { id: { in: ids } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
    ])
    const profileByUser = new Map(
      profiles.docs.map((p) => [String(typeof p.user === 'object' ? p.user.id : p.user), p]),
    )
    const emailByUser = new Map(users.docs.map((u) => [String(u.id), u.email]))

    // No profile yet (mid-onboarding) — fall back to both channels' defaults (true) rather
    // than silently dropping the notification.
    const inAppIds = ids.filter((id) => profileByUser.get(id)?.notifyInApp ?? true)
    for (let i = 0; i < inAppIds.length; i += NOTIFICATION_WRITE_CONCURRENCY) {
      await Promise.all(
        inAppIds.slice(i, i + NOTIFICATION_WRITE_CONCURRENCY).map(async (id) => {
          try {
            await payload.create({
              collection: 'notifications',
              data: { user: Number(id), title: content.title, message: content.message, link: content.link },
              overrideAccess: true,
            })
            sent.inApp++
          } catch (error) {
            payload.logger.error({ err: error, user: id }, 'Failed to write notification')
          }
        }),
      )
    }

    if (content.email) {
      const { subject, body } = content.email
      await Promise.all(
        ids.map(async (id) => {
          const to = emailByUser.get(id)
          if (!to || !(profileByUser.get(id)?.notifyEmail ?? true)) return
          try {
            await enqueueEmail(
              { to, subject, body },
              options?.jobIdPrefix ? { jobId: `${options.jobIdPrefix}-email-${id}` } : undefined,
            )
            sent.emails++
          } catch (error) {
            payload.logger.error({ err: error, user: id }, 'Failed to enqueue notification e-mail')
          }
        }),
      )
    }
  } catch (error) {
    payload.logger.error({ err: error, users: ids }, 'Failed to send notification')
  }
  return sent
}

/** httpSMS expects E.164, but onboarding accepts Czech numbers as typed ("735 929 442",
 * "+420 735…", "00420…"). A bare 9-digit number is Czech; anything unrecognisable is skipped. */
export function toE164(phone: string): string | null {
  const compact = phone.replace(/[^\d+]/g, '').replace(/^00/, '+')
  if (/^\+\d{9,15}$/.test(compact)) return compact
  if (/^\d{9}$/.test(compact)) return `+420${compact}`
  return null
}

/**
 * Brief §8 "oznámení o změně/zrušení musí jít přes SMS/mail" — SMS to whichever of these users
 * have a phone on file (onboarding step, still optional until they've filled it in). A no-op (not
 * an error) when httpSMS isn't configured — the worker logs that. httpSMS dedupes on the request
 * id, so `requestIdPrefix` must be unique per announcement but stable across retries of it.
 * Never throws; returns how many were queued.
 */
export async function sendSmsToMany(
  payload: Payload,
  userIds: (number | string)[],
  message: string,
  requestIdPrefix: string,
): Promise<number> {
  const ids = [...new Set(userIds.map(String))]
  if (ids.length === 0) return 0
  try {
    const profiles = await payload.find({
      collection: 'profiles',
      where: { user: { in: ids } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const queued = await Promise.all(
      profiles.docs.map(async (p) => {
        const to = p.phone ? toE164(p.phone) : null
        if (!to) return false
        const requestId = `${requestIdPrefix}-${typeof p.user === 'object' ? p.user.id : p.user}`
        try {
          await enqueueSms({ to, message, requestId }, { jobId: `sms-${requestId}` })
          return true
        } catch (error) {
          payload.logger.error({ err: error, requestId }, 'Failed to enqueue SMS')
          return false
        }
      }),
    )
    return queued.filter(Boolean).length
  } catch (error) {
    payload.logger.error({ err: error, users: ids }, 'Failed to send SMS')
    return 0
  }
}
