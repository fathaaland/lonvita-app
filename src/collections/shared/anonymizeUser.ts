import { randomBytes } from 'node:crypto'

import type { Payload, PayloadRequest } from 'payload'
import { APIError, commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload'

import { notYetEnded } from '../Events'
import { writeAuditLog } from './auditLog'
import { notDeleted } from './softDelete'
import type { AccountDeletionBlockingEvent } from '@/lib/accountDeletion'
import { ageOn } from '@/lib/analytics'
import { logger, serializeError } from '@/lib/logger'

/** What everyone sees in place of a deleted account's name — on past events, in "Kdo dále jde",
 * as the author of a volunteer rating. */
export const ANONYMOUS_NAME = 'Anonymní uživatel'

/** An "individual" organization carries its owner's own name — it goes with them. A business or a
 * club keeps its name: it isn't the person's. */
export const FORMER_ORGANIZER_NAME = 'Bývalý pořadatel'

const relId = (value: unknown): number | null =>
  value == null ? null : typeof value === 'object' ? (value as { id: number }).id : (value as number)

/** Events `userId` runs or co-organizes that haven't taken place yet — the account can't go while
 * there are any: they're cancelled, or left through an EventDeletionRequest, first. */
export async function findEventsBlockingDeletion(
  payload: Payload,
  userId: number | string,
  req?: PayloadRequest,
): Promise<AccountDeletionBlockingEvent[]> {
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { or: [{ organizer: { equals: userId } }, { coOrganizers: { in: [userId] } }] },
        { status: { not_equals: 'cancelled' } },
        notDeleted,
        notYetEnded(),
      ],
    },
    select: { title: true, dateTime: true },
    sort: 'dateTime',
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return events.docs.map((e) => ({ id: String(e.id), title: e.title, date_time: e.dateTime }))
}

/** Uploads to remove once the anonymization has committed — S3 can't roll back with the database. */
export type AnonymizedFiles = { mediaIds: number[]; exportIds: number[] }

/**
 * Deleting an account. The person goes — name, contacts, photo, birthday, sign-in, everything they
 * wrote in their own words — but the row and what hangs off it stay, so the obec's and the
 * organizers' overviews (registrations, attendance, ratings, residents aged 50+) count exactly as
 * before:
 * - their places on events that haven't started are given up (the team told, without a name), and
 *   pending volunteer invitations or offers withdrawn;
 * - past registrations, attendance and event ratings stay, minus excuses, notes and comments;
 * - what only described them goes: Google sign-in, consents, notifications, exports, event photos
 *   they uploaded, the ratings they got as a volunteer;
 * - an organizer's organization is hidden (an "individual" one loses its name), and every role
 *   goes — the obec's adminUser follows (UserRoles);
 * - the profile keeps its obec, its sign-up date and whether they're 50+ (`over50`); the account an
 *   address nobody owns, a password nobody knows and no sessions.
 *
 * Refused for an account already anonymized (409), a platform admin's (403 — the platform can't be
 * left without one) and anyone still running an event ahead (400, the events named). Pass the `req`
 * of a transaction; remove the returned files once it has committed (removeAnonymizedFiles).
 */
export async function anonymizeUser(req: PayloadRequest, userId: number): Promise<AnonymizedFiles> {
  const { payload } = req
  const user = await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true, req }).catch(() => null)
  if (!user) throw new APIError('Účet neexistuje.', 404)
  if (user.anonymizedAt) throw new APIError('Účet už byl smazán.', 409)
  if (user.role === 'admin') throw new APIError('Účet správce platformy v aplikaci smazat nejde.', 403)

  const blocking = await findEventsBlockingDeletion(payload, userId, req)
  if (blocking.length > 0) {
    throw new APIError(
      `Účet nejde smazat, dokud pořádáte akce, které ještě neproběhly: ${blocking.map((e) => `„${e.title}“`).join(', ')}. Zrušte je, nebo z nich odejděte přes žádost o smazání.`,
      400,
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const find = { depth: 0, pagination: false, overrideAccess: true, req } as const

  // Their places on events ahead — through the collection, so capacity, reminders and the team's
  // notice all follow (Registrations, `accountDeleted`).
  const registrations = await payload.find({ collection: 'registrations', where: { user: { equals: userId } }, ...find })
  const active = registrations.docs.filter((r) => r.status === 'pending' || r.status === 'approved')
  const upcoming = active.length
    ? await payload.find({
        collection: 'events',
        where: { and: [{ id: { in: active.map((r) => relId(r.event)) } }, { dateTime: { greater_than: nowIso } }] },
        select: { title: true },
        ...find,
      })
    : { docs: [] }
  const upcomingIds = new Set(upcoming.docs.map((e) => e.id))
  for (const registration of active.filter((r) => upcomingIds.has(relId(r.event)!))) {
    await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: { status: 'cancelled' },
      overrideAccess: true,
      context: { accountDeleted: true },
      req,
    })
  }
  const pendingInvitations = await payload.find({
    collection: 'volunteer-invitations',
    where: { and: [{ volunteer: { equals: userId } }, { status: { equals: 'pending' } }] },
    ...find,
  })
  for (const invitation of pendingInvitations.docs) {
    await payload.update({
      collection: 'volunteer-invitations',
      id: invitation.id,
      data: { status: 'withdrawn' },
      overrideAccess: true,
      context: { withdrawingVolunteerInvitations: true },
      req,
    })
  }

  // Their own words — straight through the adapter: nothing about these rows changes but the text.
  await payload.db.updateMany({
    collection: 'registrations',
    where: { user: { equals: userId } },
    data: { excuseMessage: null, attendanceNote: null },
    req,
  })
  if (registrations.docs.length > 0) {
    await payload.db.updateMany({
      collection: 'event-feedback',
      where: { registration: { in: registrations.docs.map((r) => r.id) } },
      data: { comment: null },
      req,
    })
  }
  await payload.db.updateMany({
    collection: 'volunteer-invitations',
    where: { or: [{ volunteer: { equals: userId } }, { invitedBy: { equals: userId } }] },
    data: { message: null },
    req,
  })
  await payload.db.updateMany({ collection: 'organizer-requests', where: { user: { equals: userId } }, data: { reason: null }, req })
  // `reason` is required — the obec's decision on the complaint stays, the complainant's words don't.
  await payload.db.updateMany({ collection: 'review-complaints', where: { complainant: { equals: userId } }, data: { reason: '—' }, req })

  // What only described them.
  for (const [collection, field] of [
    ['volunteer-ratings', 'volunteer'],
    ['auth-identities', 'user'],
    ['consents', 'user'],
    ['notifications', 'user'],
  ] as const) {
    await payload.delete({ collection, where: { [field]: { equals: userId } }, overrideAccess: true, req })
  }
  const mediaIds: number[] = []
  const eventMedia = await payload.find({ collection: 'event-media', where: { uploadedBy: { equals: userId } }, ...find })
  mediaIds.push(...eventMedia.docs.map((m) => relId(m.media)).filter((id): id is number => id !== null))
  if (eventMedia.docs.length > 0) {
    await payload.delete({ collection: 'event-media', where: { uploadedBy: { equals: userId } }, overrideAccess: true, req })
  }
  const exports = await payload.find({ collection: 'exports', where: { owner: { equals: userId } }, select: {}, ...find })

  // Organizing: past events stay theirs (and so the obec's history), the organization is hidden.
  const organizations = await payload.find({ collection: 'organizations', where: { owner: { equals: userId } }, ...find })
  for (const organization of organizations.docs) {
    const individual = organization.type === 'individual'
    if (individual && relId(organization.avatar) !== null) mediaIds.push(relId(organization.avatar)!)
    await payload.db.updateOne({
      collection: 'organizations',
      id: organization.id,
      data: {
        deletedAt: organization.deletedAt ?? nowIso,
        ...(individual ? { name: FORMER_ORGANIZER_NAME, description: null, avatar: null, avatarUrl: null } : {}),
      },
      req,
    })
  }
  if (organizations.docs.length > 0) {
    // Nobody is left to accept an invitation to co-organize.
    await payload.db.updateMany({
      collection: 'co-organizing-requests',
      where: { and: [{ organization: { in: organizations.docs.map((o) => o.id) } }, { status: { equals: 'pending' } }] },
      data: { status: 'rejected', reviewedAt: nowIso },
      req,
    })
  }
  await payload.delete({ collection: 'user-roles', where: { user: { equals: userId } }, overrideAccess: true, req })

  // The profile keeps what the obec's overview counts by; the account, nothing to sign in with.
  const profile = (await payload.find({ collection: 'profiles', where: { user: { equals: userId } }, limit: 1, ...find })).docs[0]
  if (profile) {
    if (relId(profile.avatar) !== null) mediaIds.push(relId(profile.avatar)!)
    await payload.db.updateOne({
      collection: 'profiles',
      id: profile.id,
      data: {
        fullName: ANONYMOUS_NAME,
        over50: profile.dateOfBirth ? ageOn(profile.dateOfBirth, now) >= 50 : Boolean(profile.over50),
        avatar: null,
        phone: null,
        phoneVerified: false,
        dateOfBirth: null,
        gender: null,
        homeArea: null,
        notifyEmail: false,
        notifyInApp: false,
        isVolunteer: false,
        volunteerNote: null,
        volunteerSince: null,
        volunteerMunicipality: null,
        volunteerAllowEmail: false,
        volunteerContactEmail: null,
        volunteerAllowPhone: false,
        volunteerContactPhone: null,
      },
      req,
    })
    // The adapter writes many-valued fields as an upsert of the whole row, which would blank the
    // columns not passed (its `user`, its obec) — these two go through the collection instead. Its
    // hooks have nothing left to react to: the volunteer flag is already off.
    await payload.update({
      collection: 'profiles',
      id: profile.id,
      data: { interests: [], volunteerFocus: [] },
      overrideAccess: true,
      req,
    })
  }
  await payload.db.updateOne({
    collection: 'users',
    id: userId,
    data: {
      email: `smazany-${userId}@anonymized.invalid`,
      salt: randomBytes(16).toString('hex'),
      hash: randomBytes(64).toString('hex'),
      sessions: [],
      resetPasswordToken: null,
      resetPasswordExpiration: null,
      loginAttempts: 0,
      lockUntil: null,
      anonymizedAt: nowIso,
    },
    req,
  })

  return { mediaIds, exportIds: exports.docs.map((e) => e.id) }
}

/** The uploads of an account anonymizeUser has just committed — their own deletes remove the files
 * from S3. Never throws: a file left behind is logged, the account is gone either way. */
export async function removeAnonymizedFiles(payload: Payload, userId: number, files: AnonymizedFiles): Promise<void> {
  const removals = [
    ...files.mediaIds.map((id) => ({ collection: 'media' as const, id })),
    ...files.exportIds.map((id) => ({ collection: 'exports' as const, id })),
  ]
  for (const { collection, id } of removals) {
    try {
      await payload.delete({ collection, id, overrideAccess: true })
    } catch (error) {
      logger.error('Anonymized account file not removed', {
        event: 'users.anonymize_file_cleanup_failed',
        userId,
        collection,
        id,
        ...serializeError(error),
      })
    }
  }
}

/**
 * anonymizeUser in a transaction of its own, then the files, then the audit trail — what both ways
 * of deleting an account do (POST /api/account/delete for one's own, the superadmin's
 * …/users/:id/anonymize). Answers with the HTTP status and, on a refusal, the reason to show.
 */
export async function deleteAccount(
  payload: Payload,
  actor: { id: number },
  userId: number,
): Promise<{ status: 200 } | { status: number; error: string }> {
  const req = await createLocalReq({ user: actor as never }, payload)
  const shouldCommit = await initTransaction(req)
  let files: AnonymizedFiles
  try {
    files = await anonymizeUser(req, userId)
    if (shouldCommit) await commitTransaction(req)
  } catch (error) {
    if (shouldCommit) await killTransaction(req)
    if (error instanceof APIError && error.status < 500) return { status: error.status, error: error.message }
    logger.error('Account deletion failed', { event: 'users.anonymize_failed', userId, actorId: actor.id, ...serializeError(error) })
    return { status: 500, error: 'Účet se nepodařilo smazat.' }
  }

  await removeAnonymizedFiles(payload, userId, files)
  writeAuditLog(payload, {
    action: 'users.anonymize',
    actor: actor.id,
    targetCollection: 'users',
    targetId: userId,
    metadata: { self: actor.id === userId },
  })
  return { status: 200 }
}
