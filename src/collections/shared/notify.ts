import type { Payload } from 'payload'

import { enqueueEmail } from '@/lib/queue/queues'

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

type SendNotificationInput = {
  userId: number | string
  title: string
  message: string
  /** In-app route the notification opens when clicked (e.g. the event detail). */
  link?: string
  /** Omit to send in-app only (no email content to send). */
  email?: { subject: string; body: string }
}

/**
 * Brief §7 "Preferovaný kanál notifikací (e-mail vs. v aplikaci), nastavitelný uživatelem" —
 * the one place that should send a user-facing notification, so every trigger respects the
 * same two independent preferences (Profiles.notifyEmail / notifyInApp, both default true).
 * Fire-and-forget throughout: a failed send must never block the write that triggered it.
 */
export async function sendNotification(payload: Payload, input: SendNotificationInput): Promise<void> {
  try {
    const [profiles, user] = await Promise.all([
      payload.find({
        collection: 'profiles',
        where: { user: { equals: input.userId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      }),
      payload.findByID({ collection: 'users', id: input.userId, depth: 0, overrideAccess: true }).catch(() => null),
    ])
    const profile = profiles.docs[0]
    // No profile yet (mid-onboarding) — fall back to both channels' defaults (true) rather
    // than silently dropping the notification.
    const wantsInApp = profile?.notifyInApp ?? true
    const wantsEmail = profile?.notifyEmail ?? true

    if (wantsInApp) {
      await payload.create({
        collection: 'notifications',
        data: { user: Number(input.userId), title: input.title, message: input.message, link: input.link },
        overrideAccess: true,
      })
    }

    if (wantsEmail && input.email && user?.email) {
      await enqueueEmail({ to: user.email, subject: input.email.subject, body: input.email.body })
    }
  } catch (error) {
    payload.logger.error({ err: error, user: input.userId }, 'Failed to send notification')
  }
}
