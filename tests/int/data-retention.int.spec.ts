// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

import { loadReliability } from '@/collections/shared/reliability'
import {
  attendanceBreakdown,
  averageRatings,
  buildEventsCsv,
  computeKpis,
  datavitaSeries,
  fillBuckets,
  regStatusBreakdown,
} from '@/lib/analytics'
import { loadMunicipalityExportData } from '@/lib/exports/load'
import { computeReportMetrics } from '@/lib/report'
import { AUDIT_LOG_GUARD_SQL, DROP_AUDIT_LOG_GUARD_SQL } from '@/migrations/20261011_200000_data_retention_audit_log'

import { processDataRetentionJob } from '../../worker/src/processors/data-retention.processor'
import { processSyncStatusesJob } from '../../worker/src/processors/sync-statuses.processor'

import type { CollectionSlug } from 'payload'

// The nightly data retention (lib/retention/policy.ts): it removes exactly what its rules allow,
// writes every removal to the audit log, and leaves every number the obec sees as it was.

let payload: Payload

const STAMP = Date.now()
const TEST_START = new Date().toISOString()
const DAY = 24 * 60 * 60 * 1000

const monthsAgo = (months: number) => {
  const date = new Date()
  date.setMonth(date.getMonth() - months)
  return date.toISOString()
}
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const daysAhead = (days: number) => new Date(Date.now() + days * DAY).toISOString()

type TestUser = { id: number; email: string }

const db = () => (payload.db as unknown as PostgresAdapter).drizzle

const exists = async (collection: CollectionSlug, id: number) =>
  (await payload.find({ collection, where: { id: { equals: id } }, depth: 0, limit: 1, overrideAccess: true })).docs.length === 1

describe('Data retention', () => {
  let muni: { id: number }
  let cat: { id: number }
  let organization: { id: number }
  let organizer: TestUser
  let admin: TestUser
  let people: TestUser[]
  const userIds: number[] = []
  const eventIds: number[] = []
  const registrationIds: number[] = []

  const f = {} as Record<string, number>

  const makeUser = async (name: string, role: 'organizer' | null = null, platformRole: 'admin' | 'user' = 'user') => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `retention-${name}-${STAMP}@test.local`, password: 'test1234', role: platformRole },
      overrideAccess: true,
    })
    userIds.push(user.id)
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Retention ${name}`, municipality: muni.id, notifyEmail: false },
      overrideAccess: true,
    })
    if (role) await payload.create({ collection: 'user-roles', data: { user: user.id, municipality: muni.id, role }, overrideAccess: true })
    return user as TestUser
  }

  /** Trusted writes — past dates, cancelled states and decided requests can't be made through the app. */
  const makeEvent = async (name: string, dateTime: string, extra: Record<string, unknown> = {}) => {
    const event = await payload.db.create({
      collection: 'events',
      data: {
        title: `Retention ${name} ${STAMP}`,
        dateTime,
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 20,
        organizer: organizer.id,
        categories: [cat.id],
        municipality: muni.id,
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
        coOrganizations: [],
        coOrganizers: [],
        ...extra,
      },
    })
    eventIds.push(event.id)
    return event.id as number
  }

  const makeRegistration = async (event: number, user: TestUser, status: string, extra: Record<string, unknown> = {}) => {
    const registration = await payload.db.create({
      collection: 'registrations',
      data: { event, user: user.id, status, role: 'participant', ...extra },
    })
    registrationIds.push(registration.id)
    return registration.id as number
  }

  const makeMedia = async (name: string, createdAt: string) => {
    const media = await payload.db.create({
      collection: 'media',
      data: { alt: name, filename: `retention-${STAMP}-${name}.jpg` },
    })
    await db().execute(sql`UPDATE media SET created_at = ${createdAt}::timestamptz WHERE id = ${media.id}`)
    return media.id as number
  }

  const make = async (collection: CollectionSlug, data: Record<string, unknown>) =>
    ((await payload.db.create({ collection, data })) as { id: number }).id

  /** Everything the obec's overview, its report, the export and the reliability badges show. */
  const statistics = async () => {
    const { events, registrations, profiles, categories } = await loadMunicipalityExportData(payload, String(muni.id))
    const feedback = await payload.find({
      collection: 'event-feedback',
      where: { registration: { in: registrations.map((r) => r.id) } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const reliability = await loadReliability(
      payload,
      people.map((p) => p.id),
    )
    return {
      kpis: computeKpis(events, registrations, profiles),
      status: regStatusBreakdown(registrations, events),
      attendance: attendanceBreakdown(registrations),
      fill: fillBuckets(events, registrations),
      datavita: datavitaSeries(events, registrations, profiles, 52),
      report: computeReportMetrics(events, registrations, profiles),
      csv: buildEventsCsv(events, registrations, categories, profiles),
      ratings: averageRatings(
        feedback.docs.map((d) => ({
          id: String(d.id),
          registration_id: String(d.registration),
          satisfaction_rating: d.satisfactionRating,
          felt_welcome_rating: d.feltWelcomeRating ?? null,
        })),
      ),
      reliability: Object.fromEntries(reliability),
    }
  }

  let before: Awaited<ReturnType<typeof statistics>>

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Retention Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    cat = await payload.create({ collection: 'event-categories', data: { name: `Test Category Retention ${STAMP}` }, overrideAccess: true })
    organizer = await makeUser('organizer', 'organizer')
    admin = await makeUser('admin', null, 'admin')
    people = await Promise.all(['p1', 'p2', 'p3', 'p4', 'p5'].map((name) => makeUser(name)))
    const [p1, p2, p3, p4, p5] = people
    organization = { id: await make('organizations', { name: `Retention spolek ${STAMP}`, type: 'association', municipality: muni.id, owner: organizer.id }) }

    f.orphanOld = await makeMedia('orphan-old', daysAgo(3))
    f.orphanNew = await makeMedia('orphan-new', new Date().toISOString())
    f.avatar = await makeMedia('avatar', daysAgo(3))
    f.coverOfRecentCancelled = await makeMedia('cover-recent-cancelled', daysAgo(3))
    f.coverOfOldCancelled = await makeMedia('cover-old-cancelled', daysAgo(3))
    await db().execute(sql`UPDATE profiles SET avatar_id = ${f.avatar} WHERE user_id = ${p1.id}`)

    f.oldHeld = await makeEvent('old held', monthsAgo(8), { status: 'finished' })
    f.recentHeld = await makeEvent('recent held', monthsAgo(2), { status: 'finished' })
    f.oldCancelled = await makeEvent('old cancelled', monthsAgo(8), {
      status: 'cancelled',
      deletedAt: monthsAgo(9),
      image: f.coverOfOldCancelled,
    })
    f.recentCancelled = await makeEvent('recent cancelled', daysAgo(20), {
      status: 'cancelled',
      deletedAt: daysAgo(30),
      image: f.coverOfRecentCancelled,
    })
    f.future = await makeEvent('future', daysAhead(30))

    // The old event: who came and who didn't stay; a cancellation and an undecided sign-up go.
    f.oldAttended = await makeRegistration(f.oldHeld, p1, 'approved', { attendanceStatus: 'attended' })
    f.oldNoShow = await makeRegistration(f.oldHeld, p2, 'approved', { attendanceStatus: 'no_show' })
    f.oldCancelledReg = await makeRegistration(f.oldHeld, p3, 'cancelled', { selfCancelled: true, cancelledAt: monthsAgo(9) })
    f.oldPending = await makeRegistration(f.oldHeld, p4, 'pending')
    f.oldRejected = await makeRegistration(f.oldHeld, p5, 'rejected')
    await make('event-feedback', { registration: f.oldAttended, satisfactionRating: 5, feltWelcomeRating: 4 })
    // Inside the reliability window — all of it stays (the omluva still counts).
    f.recentAttended = await makeRegistration(f.recentHeld, p1, 'approved', { attendanceStatus: 'attended' })
    f.recentCancelledReg = await makeRegistration(f.recentHeld, p3, 'cancelled', { selfCancelled: true, cancelledAt: monthsAgo(3) })
    f.recentPending = await makeRegistration(f.recentHeld, p4, 'pending')
    await make('event-feedback', { registration: f.recentAttended, satisfactionRating: 3, feltWelcomeRating: 5 })
    f.onOldCancelled = await makeRegistration(f.oldCancelled, p1, 'approved')
    f.futureApproved = await makeRegistration(f.future, p2, 'approved')
    f.futureCancelled = await makeRegistration(f.future, p3, 'cancelled')

    const coOrganizing = (event: number, reviewedAt: string) =>
      make('co-organizing-requests', {
        event,
        eventTitle: 'Retention',
        municipality: muni.id,
        organization: organization.id,
        organizationName: 'Retention spolek',
        requestedBy: organizer.id,
        status: 'rejected',
        reviewedAt,
        expiresAt: reviewedAt,
      })
    f.coOld = await coOrganizing(f.oldHeld, daysAgo(100))
    f.coRecent = await coOrganizing(f.oldHeld, daysAgo(10))
    f.coFuture = await coOrganizing(f.future, daysAgo(100))

    const deletionRequest = (event: number) =>
      make('event-deletion-requests', {
        event,
        eventTitle: 'Retention',
        municipality: muni.id,
        requestedBy: organizer.id,
        status: 'rejected',
        decidedAt: daysAgo(100),
        expiresAt: daysAgo(99),
      })
    f.deletionOld = await deletionRequest(f.oldHeld)
    // Refused, but the requester may still turn to the obec until the event starts.
    f.deletionFuture = await deletionRequest(f.future)

    f.organizerOld = await make('organizer-requests', { user: p1.id, municipality: muni.id, status: 'rejected', reviewedAt: monthsAgo(13) })
    f.organizerRecent = await make('organizer-requests', { user: p2.id, municipality: muni.id, status: 'rejected', reviewedAt: monthsAgo(2) })

    f.poolOld = await make('pool-invitations', { user: p1.id, municipality: muni.id, invitedBy: organizer.id, status: 'declined', decidedAt: daysAgo(100) })
    f.poolRecent = await make('pool-invitations', { user: p2.id, municipality: muni.id, invitedBy: organizer.id, status: 'declined', decidedAt: daysAgo(10) })
    f.poolPending = await make('pool-invitations', { user: p3.id, municipality: muni.id, invitedBy: organizer.id, status: 'pending' })
    await db().execute(sql`UPDATE pool_invitations SET created_at = ${daysAgo(200)}::timestamptz, updated_at = ${daysAgo(200)}::timestamptz WHERE id = ${f.poolPending}`)

    const volunteer = (event: number, user: TestUser, status: string) =>
      make('volunteer-invitations', { event, eventTitle: 'Retention', volunteer: user.id, invitedBy: organizer.id, kind: 'invitation', status })
    f.volunteerOld = await volunteer(f.oldHeld, p1, 'declined')
    f.volunteerRecent = await volunteer(f.recentHeld, p1, 'declined')
    f.volunteerAccepted = await volunteer(f.oldHeld, p2, 'accepted')
    f.volunteerPendingStarted = await volunteer(f.recentHeld, p2, 'pending')
    f.volunteerPendingFuture = await volunteer(f.future, p1, 'pending')

    const auditAt = async (age: string) =>
      Number(
        (
          await db().execute(sql`
            INSERT INTO audit_log (action, target_collection, target_id, created_at, updated_at)
            VALUES (${`test.retention.${STAMP}`}, 'test', ${age}, now() - ${age}::interval, now())
            RETURNING id`)
        ).rows[0].id,
      )
    f.auditOld = await auditAt('40 months')
    f.auditMid = await auditAt('20 months')

    before = await statistics()
  })

  afterAll(async () => {
    await db().execute(DROP_AUDIT_LOG_GUARD_SQL).catch(() => {})
    const quiet = <T>(p: Promise<T>) => p.catch(() => {})
    await quiet(payload.delete({ collection: 'volunteer-invitations', where: { event: { in: eventIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'co-organizing-requests', where: { event: { in: eventIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'event-deletion-requests', where: { requestedBy: { equals: organizer.id } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'organizer-requests', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'pool-invitations', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'event-feedback', where: { registration: { in: registrationIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }))
    await quiet(db().execute(sql`UPDATE profiles SET avatar_id = NULL WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${`retention-%-${STAMP}@test.local`})`))
    await quiet(payload.delete({ collection: 'media', where: { filename: { contains: `retention-${STAMP}-` } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'organizations', where: { municipality: { equals: muni.id } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(
      db().execute(sql`
        DELETE FROM audit_log
        WHERE action = ${`test.retention.${STAMP}`}
           OR (created_at >= ${TEST_START}::timestamptz
               AND action IN ('data-retention.purge', 'data-retention.run', 'events.purge', 'events.cancel', 'audit-log.read'))
           OR actor_id IN (SELECT id FROM users WHERE email LIKE ${`retention-%-${STAMP}@test.local`})`),
    )
    await quiet(payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'event-categories', id: cat.id, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }))
  })

  it('the status sync withdraws a volunteer invitation nobody can accept any more', async () => {
    const result = await processSyncStatusesJob()
    expect(result.volunteerInvitationsWithdrawn).toBeGreaterThanOrEqual(1)
    const status = async (id: number) =>
      (await payload.findByID({ collection: 'volunteer-invitations', id, depth: 0, overrideAccess: true })).status
    expect(await status(f.volunteerPendingStarted)).toBe('withdrawn')
    expect(await status(f.volunteerPendingFuture)).toBe('pending')
  })

  it('a dry run only counts', async () => {
    const result = await processDataRetentionJob({ mode: 'dry-run' })
    expect(result.failed).toEqual([])
    expect(result.steps['stale-registrations'].matched).toBeGreaterThanOrEqual(2)
    expect(result.steps['cancelled-events'].matched).toBeGreaterThanOrEqual(1)
    expect(result.steps['orphaned-uploads'].matched).toBeGreaterThanOrEqual(1)
    expect(Object.values(result.steps).every((step) => step.deleted === 0)).toBe(true)
    expect(await exists('registrations', f.oldPending)).toBe(true)
    expect(await exists('events', f.oldCancelled)).toBe(true)
    expect(await exists('media', f.orphanOld)).toBe(true)
  })

  describe('enforced', () => {
    beforeAll(async () => {
      const result = await processDataRetentionJob({ mode: 'enforce' })
      expect(result.failed).toEqual([])
    })

    it('removes what the rules allow', async () => {
      const gone: [CollectionSlug, string][] = [
        ['registrations', 'oldCancelledReg'],
        ['registrations', 'oldPending'],
        ['registrations', 'onOldCancelled'],
        ['events', 'oldCancelled'],
        ['media', 'coverOfOldCancelled'],
        ['media', 'orphanOld'],
        ['co-organizing-requests', 'coOld'],
        ['event-deletion-requests', 'deletionOld'],
        ['organizer-requests', 'organizerOld'],
        ['pool-invitations', 'poolOld'],
        ['volunteer-invitations', 'volunteerOld'],
        ['audit-log', 'auditOld'],
      ]
      for (const [collection, key] of gone) expect(await exists(collection, f[key]), `${key} should be gone`).toBe(false)
    })

    it('keeps everything else', async () => {
      const kept: [CollectionSlug, string][] = [
        ['registrations', 'oldAttended'],
        ['registrations', 'oldNoShow'],
        ['registrations', 'oldRejected'],
        ['registrations', 'recentAttended'],
        ['registrations', 'recentCancelledReg'],
        ['registrations', 'recentPending'],
        ['registrations', 'futureApproved'],
        ['registrations', 'futureCancelled'],
        ['events', 'oldHeld'],
        ['events', 'recentCancelled'],
        ['media', 'orphanNew'],
        ['media', 'avatar'],
        ['media', 'coverOfRecentCancelled'],
        ['co-organizing-requests', 'coRecent'],
        ['co-organizing-requests', 'coFuture'],
        ['event-deletion-requests', 'deletionFuture'],
        ['organizer-requests', 'organizerRecent'],
        ['pool-invitations', 'poolRecent'],
        ['pool-invitations', 'poolPending'],
        ['volunteer-invitations', 'volunteerRecent'],
        ['volunteer-invitations', 'volunteerAccepted'],
        ['audit-log', 'auditMid'],
      ]
      for (const [collection, key] of kept) expect(await exists(collection, f[key]), `${key} should stay`).toBe(true)
    })

    it('leaves every statistic exactly as it was', async () => {
      expect(await statistics()).toEqual(before)
    })

    it('writes every removal to the audit log', async () => {
      const entries = (
        await payload.find({
          collection: 'audit-log',
          where: {
            and: [
              { action: { in: ['data-retention.purge', 'events.purge', 'data-retention.run'] } },
              { createdAt: { greater_than_equal: TEST_START } },
            ],
          },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      ).docs
      const purgedIds = (collection: string) =>
        entries
          .filter((e) => e.action === 'data-retention.purge' && e.targetCollection === collection)
          .flatMap((e) => ((e.metadata as { ids?: number[] }).ids ?? []).map(Number))

      expect(purgedIds('registrations')).toEqual(expect.arrayContaining([f.oldCancelledReg, f.oldPending]))
      expect(purgedIds('media')).toContain(f.orphanOld)
      expect(purgedIds('co-organizing-requests')).toContain(f.coOld)
      expect(purgedIds('audit-log')).toContain(f.auditOld)
      const eventPurge = entries.find((e) => e.action === 'events.purge' && e.targetId === String(f.oldCancelled))
      expect(eventPurge?.metadata).toMatchObject({ title: `Retention old cancelled ${STAMP}` })
      expect(eventPurge?.municipality).toBe(muni.id)
      expect(entries.some((e) => e.action === 'data-retention.run')).toBe(true)
    })
  })

  describe('the audit trail of people', () => {
    it('cancelling an event is on the record, with who and from where', async () => {
      const event = await makeEvent('to cancel', daysAhead(20))
      await payload.update({
        collection: 'events',
        id: event,
        data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
        user: organizer,
        overrideAccess: false,
        context: { skipNotifications: true },
      })
      await vi.waitFor(async () => {
        const entry = (
          await payload.find({
            collection: 'audit-log',
            where: { and: [{ action: { equals: 'events.cancel' } }, { targetId: { equals: String(event) } }] },
            depth: 0,
            overrideAccess: true,
          })
        ).docs[0]
        expect(entry).toMatchObject({ actor: organizer.id, outcome: 'success', municipality: muni.id })
      })
    })

    it('reading the audit log is itself recorded', async () => {
      await payload.find({ collection: 'audit-log', limit: 1, user: admin, overrideAccess: false })
      const reads = await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: 'audit-log.read' } }, { actor: { equals: admin.id } }] },
        depth: 0,
        overrideAccess: true,
      })
      expect(reads.totalDocs).toBeGreaterThanOrEqual(1)
    })
  })

  describe('the database guard (migration 20261011_200000)', () => {
    beforeAll(async () => {
      await db().execute(AUDIT_LOG_GUARD_SQL)
    })
    afterAll(async () => {
      await db().execute(DROP_AUDIT_LOG_GUARD_SQL)
    })

    /** The guard's own words — not just any failure (drizzle wraps the driver's error in `cause`). */
    const refusal = async (query: Promise<unknown>): Promise<string> => {
      try {
        await query
      } catch (error) {
        const { message, cause } = error as { message: string; cause?: { message?: string } }
        return cause?.message ?? message
      }
      return 'not refused'
    }

    const insertAged = async (age: string, actorId: number | null = null) =>
      Number(
        (
          await db().execute(sql`
            INSERT INTO audit_log (action, target_collection, target_id, actor_id, created_at, updated_at)
            VALUES (${`test.retention.${STAMP}`}, 'test', 'guard', ${actorId}, now() - ${age}::interval, now())
            RETURNING id`)
        ).rows[0].id,
      )

    it('refuses to change an entry', async () => {
      const id = await insertAged('1 day')
      expect(await refusal(db().execute(sql`UPDATE audit_log SET action = 'forged' WHERE id = ${id}`))).toMatch(/append-only/)
    })

    it('refuses to delete an entry younger than 18 months, allows an older one', async () => {
      const young = await insertAged('17 months')
      const old = await insertAged('19 months')
      expect(await refusal(db().execute(sql`DELETE FROM audit_log WHERE id = ${young}`))).toMatch(/younger than 18 months/)
      await db().execute(sql`DELETE FROM audit_log WHERE id = ${old}`)
      expect(await exists('audit-log', old)).toBe(false)
    })

    it('lets a deleted user go — the entry stays, without its actor', async () => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `retention-gone-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      const id = await insertAged('1 day', user.id)
      await db().execute(sql`DELETE FROM users WHERE id = ${user.id}`)
      const row = await payload.findByID({ collection: 'audit-log', id, depth: 0, overrideAccess: true })
      expect(row.actor).toBeNull()
    })

    it('refuses TRUNCATE, even the CASCADE that gets past the foreign keys', async () => {
      // Inside a transaction that's rolled back whatever happens — this runs on the shared dev database.
      const outcome = await refusal(
        db().transaction(async (tx) => {
          await tx.execute(sql`TRUNCATE audit_log CASCADE`)
          throw new Error('truncated — rolled back')
        }),
      )
      expect(outcome).toMatch(/TRUNCATE is not allowed/)
    })
  })
})
