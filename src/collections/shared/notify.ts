import type { Payload, PayloadRequest } from 'payload'

import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'
import { toE164 } from '@/lib/phone'
import { enqueueOrPark } from '@/lib/outbox'
import { JOB_NAMES } from '@/lib/queue/contracts'
import { enqueueEmail } from '@/lib/queue/queues'
import {
  CANCELLATION_SMS_PREFIX,
  cancellationSmsText,
  planCancellationSms,
  smsAllowanceOf,
  smsPartsOf,
} from '@/lib/billing/sms'
import { releaseSmsReservation, smsPartsHeldBy, withSmsQuotaReservation } from '@/lib/billing/sms-reservations'

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
    .catch((error) =>
      payload.logger.error({ err: error, user: input.user }, 'Failed to write notification'),
    )
}

/** IDs of users holding "municipality_admin" for the given municipality — the audience for
 * "new organizer/volunteering request" notifications (brief §7 notification table). */
export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const getMunicipalityAdminUserIds = async (
  payload: Payload,
  municipalityId: number | string,
): Promise<number[]> => {
  const result = await payload.find({
    collection: 'user-roles',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { role: { equals: 'municipality_admin' } },
      ],
    },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })
  return result.docs.map((doc) => (typeof doc.user === 'object' ? doc.user.id : doc.user))
}

/**
 * Who answers what's waiting on the obec — an organizer request, a complaint about a review, an
 * escalated deletion, an invitation for the obec to co-organize — and where they do it. Its admins,
 * in the obec's admin; an obec without one (not appointed yet, or the platform admin took the last
 * one away) is looked after by the platform admins, in their own panel, so nothing waits on nobody.
 */
export async function getObecDeciders(
  payload: Payload,
  municipalityId: number | string,
): Promise<{ userIds: number[]; requestsLink: string }> {
  const adminIds = await getMunicipalityAdminUserIds(payload, municipalityId)
  if (adminIds.length > 0) return { userIds: adminIds, requestsLink: '/admin-obce?tab=requests' }
  return getPlatformDeciders(payload)
}

/** The platform admins, in their own panel — for what an obec can't decide (an obec without an
 * admin, a complaint the obec is a party to). */
export async function getPlatformDeciders(
  payload: Payload,
): Promise<{ userIds: number[]; requestsLink: string }> {
  const platformAdmins = await payload.find({
    collection: 'users',
    where: { role: { equals: 'admin' } },
    select: { role: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return { userIds: platformAdmins.docs.map((u) => u.id), requestsLink: '/superadmin?tab=requests' }
}

type EventTeamSource = {
  organizer?: unknown
  coOrganizers?: unknown[] | null
  organization?: unknown
  coOrganizations?: unknown[] | null
  municipality?: unknown
}

const teamRelId = (value: unknown): string | null =>
  value == null ? null : String(typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * Everyone who runs the event and so hears about what happens on it: the pořadatel, every
 * spolupořadatel and — for each obec running or co-organizing it, its own obec or a neighbouring
 * one from its mikroregion — each of that obec's admins (any one of them answers for the obec).
 * `exclude` drops whoever caused the notification. Pass `req` from inside a transaction that may
 * have just changed who organizes it.
 */
export async function getEventTeamUserIds(
  payload: Payload,
  event: EventTeamSource,
  {
    exclude = [],
    req,
  }: { exclude?: (number | string | null | undefined)[]; req?: PayloadRequest } = {},
): Promise<string[]> {
  const ids = new Set(
    [event.organizer, ...(event.coOrganizers ?? [])]
      .map(teamRelId)
      .filter((id): id is string => id !== null),
  )
  const organizationIds = [event.organization, ...(event.coOrganizations ?? [])]
    .map(teamRelId)
    .filter((id): id is string => id !== null)
  if (organizationIds.length > 0) {
    const obce = await payload.find({
      collection: 'organizations',
      where: {
        and: [
          { id: { in: organizationIds } },
          { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } },
        ],
      },
      select: { municipality: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
    const municipalityIds = [
      ...new Set(
        obce.docs.map((o) => teamRelId(o.municipality)).filter((id): id is string => id !== null),
      ),
    ]
    for (const municipalityId of municipalityIds) {
      for (const adminId of await getMunicipalityAdminUserIds(payload, municipalityId))
        ids.add(String(adminId))
    }
  }
  for (const id of exclude) if (id != null) ids.delete(String(id))
  return [...ids]
}

/** "Jana Nováková (jana@example.cz)" — how a participant is named to the event's team, so they know
 * whom to reach. Falls back to whichever half is known. */
export async function describeUser(payload: Payload, userId: number | string): Promise<string> {
  const [profile, user] = await Promise.all([
    payload.find({
      collection: 'profiles',
      where: { user: { equals: userId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    }),
    payload
      .findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })
      .catch(() => null),
  ])
  const name = profile.docs[0]?.fullName?.trim()
  // A deleted (anonymized) account's address is a placeholder nobody reads — just "Anonymní uživatel".
  const email = user?.anonymizedAt ? undefined : user?.email
  if (name && email) return `${name} (${email})`
  return name || email || 'Účastník'
}

type NotificationContent = {
  title: string
  message: string
  /** In-app route the notification opens when clicked (e.g. the event detail). */
  link?: string
  /** Omit to send in-app only (no email content to send). */
  email?: { subject: string; body: string }
  /**
   * Something the recipient must not miss — the event they signed up for is cancelled, moved or
   * its team writes to them. Goes out in the app and by e-mail whatever the preferences say:
   * someone who switched both off would otherwise learn about it only by turning up.
   */
  critical?: boolean
}

type SendNotificationInput = NotificationContent & { userId: number | string }

/**
 * Brief §7 "Preferovaný kanál notifikací (e-mail vs. v aplikaci), nastavitelný uživatelem" —
 * the one place that should send a user-facing notification, so every trigger respects the
 * same two independent preferences (Profiles.notifyEmail / notifyInApp, both default true).
 * Fire-and-forget throughout: a failed send must never block the write that triggered it.
 */
export async function sendNotification(
  payload: Payload,
  input: SendNotificationInput,
): Promise<void> {
  const { userId, ...content } = input
  await sendNotificationToMany(payload, [userId], content)
}

/** Payload reports a unique field clash as a ValidationError on that field; the driver's own
 * error (code 23505) can surface instead when the clash comes from a concurrent insert. */
const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { name?: string; code?: string; cause?: { code?: string }; data?: { errors?: { path?: string }[] } }
  if (e?.code === '23505' || e?.cause?.code === '23505') return true
  return e?.name === 'ValidationError' && Boolean(e.data?.errors?.some((err) => err.path === 'dedupKey'))
}

/** In-app writes in flight at once — enough to be quick, few enough not to hog the DB pool. */
const NOTIFICATION_WRITE_CONCURRENCY = 10

/**
 * `sendNotification` for a whole audience (e.g. an event's registrants) — the same message and
 * preferences, but two lookups for everyone instead of two per user. Never throws; a failure for
 * one user is logged and the rest still get theirs. `jobIdPrefix` makes the e-mail jobs
 * idempotent, for callers that may run twice (a worker job retried after a crash). `inApp: false`
 * sends the e-mail alone.
 */
export async function sendNotificationToMany(
  payload: Payload,
  userIds: (number | string)[],
  content: NotificationContent,
  options?: { jobIdPrefix?: string; inApp?: boolean },
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
    // `inApp: false` — the in-app copy already went out on its own (e.g. registration digests).
    const inAppIds =
      options?.inApp === false
        ? []
        : ids.filter((id) => content.critical || (profileByUser.get(id)?.notifyInApp ?? true))
    for (let i = 0; i < inAppIds.length; i += NOTIFICATION_WRITE_CONCURRENCY) {
      await Promise.all(
        inAppIds.slice(i, i + NOTIFICATION_WRITE_CONCURRENCY).map(async (id) => {
          const dedupKey = options?.jobIdPrefix ? `${options.jobIdPrefix}-inapp-${id}` : undefined
          try {
            await payload.create({
              collection: 'notifications',
              data: {
                user: Number(id),
                title: content.title,
                message: content.message,
                link: content.link,
                dedupKey,
              },
              overrideAccess: true,
            })
            sent.inApp++
          } catch (error) {
            // Written by the earlier run of the same broadcast — that's the point of the key.
            if (dedupKey && isUniqueViolation(error)) return
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
          if (!to || !(content.critical || (profileByUser.get(id)?.notifyEmail ?? true))) return
          const jobId = options?.jobIdPrefix ? `${options.jobIdPrefix}-email-${id}` : undefined
          try {
            // One that must not be missed waits in the outbox while the queue is down (lib/outbox).
            if (content.critical) {
              await enqueueOrPark(payload, { job: { jobType: JOB_NAMES.SEND_EMAIL, payload: { to, subject, body } }, jobId })
            } else {
              await enqueueEmail({ to, subject, body }, jobId ? { jobId } : undefined)
            }
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

export { toE164 } from '@/lib/phone'

/**
 * Those of `userIds` who chose SMS and have a phone on file, in the order given — the callers pass
 * the registrants in their priority (approved first, then by when they signed up), so whoever is
 * left out when the quota runs short is decided, not random.
 */
export async function findSmsReachable(
  payload: Payload,
  userIds: (number | string)[],
): Promise<{ to: string; userId: number }[]> {
  const ids = [...new Set(userIds.map(String))]
  if (ids.length === 0) return []
  const profiles = await payload.find({
    collection: 'profiles',
    where: { and: [{ user: { in: ids } }, { notifySms: { equals: true } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const byUser = new Map<string, { to: string; userId: number }>()
  for (const p of profiles.docs) {
    const to = p.phone ? toE164(p.phone) : null
    const userId = typeof p.user === 'object' ? p.user.id : p.user
    if (to) byUser.set(String(userId), { to, userId })
  }
  return ids.flatMap((id) => byUser.get(id) ?? [])
}

/** How an SMS round went: `wanted` chose SMS and have a phone, `queued` were queued, `withheld`
 * weren't because the obec's quota ran short (an obec without SMS, or suspended, withholds nothing —
 * it texts nobody by design). Those not texted hear it in-app and by e-mail all the same. */
export type SmsOutcome = { wanted: number; queued: number; withheld: number }

const NO_SMS: SmsOutcome = { wanted: 0, queued: 0, withheld: 0 }

/**
 * "Akce byla zrušena" by SMS — the only SMS Lonvita sends (decided 12. 11. 2026; never for a change,
 * a reminder or anything else). To those of `userIds` (in their priority order) who chose SMS in their
 * profile and have a phone, for an obec that has the SMS package and isn't suspended; the caller
 * checks the event's size (SMS_LARGE_EVENT_CAPACITY). The text is built here from the title alone
 * (cancellationSmsText: one part, no links) — no caller can send anything else.
 *
 * Its quota (lib/billing/sms planCancellationSms): a cancellation that starts while the obec has any
 * SMS left goes to everyone, the part past the quota billed as overage; with nothing left, nobody is
 * texted — they hear it in-app and by e-mail, which go out all the same. Decided under the obec's quota
 * lock against what's sent plus what's queued, and again by the worker's ledger (sms-ledger).
 *
 * `announcementId` must start with CANCELLATION_SMS_PREFIX, be unique per cancellation and stable
 * across retries of it: the request ids are `<announcementId>-<userId>`, and whoever the ledger already
 * has an SMS of this cancellation for is neither texted again nor holds the quota again. A no-op (not
 * an error) when BulkGate isn't configured — the worker logs that. Never throws.
 */
export async function sendCancellationSms(
  payload: Payload,
  municipalityId: number,
  userIds: (number | string)[],
  eventTitle: string,
  announcementId: string,
): Promise<SmsOutcome> {
  if (userIds.length === 0) return NO_SMS
  if (!announcementId.startsWith(CANCELLATION_SMS_PREFIX)) {
    payload.logger.error({ announcementId }, 'SMS refused — not a cancellation')
    return NO_SMS
  }
  try {
    const requestIdOf = (userId: number) => `${announcementId}-${userId}`
    const reachable = await findSmsReachable(payload, userIds)
    if (reachable.length === 0) return NO_SMS
    // A retry of this cancellation (the job ran again after a crash): whoever's SMS is already on the
    // ledger got it — not again, and not holding the quota again either.
    const onLedger = await payload.find({
      collection: 'sms-messages',
      where: { requestId: { in: reachable.map((r) => requestIdOf(r.userId)) } },
      select: { requestId: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const sent = new Set(onLedger.docs.map((d) => d.requestId))
    const pending = reachable.filter((r) => !sent.has(requestIdOf(r.userId)))
    if (pending.length === 0) return { wanted: reachable.length, queued: 0, withheld: 0 }

    const text = cancellationSmsText(eventTitle)
    const parts = smsPartsOf(text)
    const { recipients, active } = await withSmsQuotaReservation(municipalityId, async (reservedParts) => {
      const allowance = await smsAllowanceOf(payload, municipalityId, new Date())
      // An SMS of this cancellation already queued holds its own parts — not counted against itself.
      const ownHeld = await smsPartsHeldBy(municipalityId, announcementId)
      const chosen = sent.size > 0
        ? pending.map((r) => ({ ...r, overage: false })) // started earlier, so it was admitted then
        : planCancellationSms(pending, parts, allowance, reservedParts - ownHeld)
      return {
        result: { recipients: allowance.active ? chosen : [], active: allowance.active },
        reserve: allowance.active ? chosen.map((r) => ({ requestId: requestIdOf(r.userId), parts })) : [],
      }
    })
    if (!active) return { wanted: reachable.length, queued: 0, withheld: 0 }
    if (recipients.length < pending.length) {
      payload.logger.warn(
        { municipalityId, wanted: pending.length, skipped: pending.length - recipients.length },
        'SMS quota of the obec used up — the cancellation not texted',
      )
    }
    const queued = await Promise.all(
      recipients.map(async ({ to, userId }) => {
        const requestId = requestIdOf(userId)
        try {
          // A cancellation notice must not be missed — parked in the outbox while the queue is down
          // (lib/outbox).
          await enqueueOrPark(payload, {
            job: { jobType: JOB_NAMES.SEND_SMS, payload: { to, message: text, requestId, municipalityId } },
            jobId: `sms-${requestId}`,
          })
          return true
        } catch (error) {
          payload.logger.error({ err: error, requestId }, 'Failed to enqueue SMS')
          // Never queued: the parts it held go back straight away.
          await releaseSmsReservation(municipalityId, requestId, parts)
          return false
        }
      }),
    )
    return {
      wanted: reachable.length,
      queued: queued.filter(Boolean).length,
      withheld: pending.length - recipients.length,
    }
  } catch (error) {
    payload.logger.error({ err: error, users: userIds.map(String) }, 'Failed to send SMS')
    return NO_SMS
  }
}
