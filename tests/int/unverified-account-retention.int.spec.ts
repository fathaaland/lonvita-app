// @vitest-environment node
// The nightly rule that removes password sign-ups that never proved their address (lib/retention/
// policy.ts unverifiedAccountDays): only what could do nothing yet, and never what has anything on it.
import { getPayload, Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { recordAuditLog } from '@/collections/shared/auditLog'
import { processDataRetentionJob } from '../../worker/src/processors/data-retention.processor'

let payload: Payload

const STAMP = Date.now()
const TEST_START = new Date().toISOString()
const db = () => (payload.db as unknown as PostgresAdapter).drizzle

const quiet = (promise: Promise<unknown>) => promise.catch(() => undefined)

describe('Retention of unverified accounts', () => {
  const userIds: number[] = []
  let muni: { id: number }
  const u = {} as Record<string, number>

  const makeUser = async (
    name: string,
    {
      ageDays,
      verified = false,
      onboarded = false,
      codeSent = true,
    }: { ageDays: number; verified?: boolean; onboarded?: boolean; codeSent?: boolean },
  ) => {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `unverified-${name}-${STAMP}@test.local`,
        password: 'test1234',
        role: 'user',
        ...(verified ? { emailVerifiedAt: new Date().toISOString() } : {}),
        ...(codeSent ? { emailCodeSentAt: new Date().toISOString() } : {}),
      },
      overrideAccess: true,
    })
    userIds.push(user.id)
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Neověřený ${name}`, municipality: muni.id, notifyEmail: false, onboardingCompleted: onboarded },
      overrideAccess: true,
    })
    await db().execute(sql`UPDATE users SET created_at = now() - ${`${ageDays} days`}::interval WHERE id = ${user.id}`)
    return user.id
  }

  const exists = async (id: number) =>
    (await payload.find({ collection: 'users', where: { id: { equals: id } }, depth: 0, limit: 1, overrideAccess: true })).docs
      .length === 1

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    muni = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Unverified Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })

    u.abandoned = await makeUser('abandoned', { ageDays: 10 })
    u.recent = await makeUser('recent', { ageDays: 1 })
    u.verified = await makeUser('verified', { ageDays: 10, verified: true })
    u.legacy = await makeUser('legacy', { ageDays: 10, onboarded: true })
    u.neverSent = await makeUser('never-sent', { ageDays: 10, codeSent: false })
    u.staffCreated = await makeUser('staff-created', { ageDays: 10 })
    await recordAuditLog(payload, { action: 'users.create-by-admin', targetCollection: 'users', targetId: u.staffCreated })
    u.withRole = await makeUser('with-role', { ageDays: 10 })
    await payload.create({ collection: 'user-roles', data: { user: u.withRole, municipality: muni.id, role: 'organizer' }, overrideAccess: true })

    await processDataRetentionJob({ mode: 'enforce' })
  })

  afterAll(async () => {
    await quiet(payload.delete({ collection: 'organizations', where: { municipality: { equals: muni.id } }, overrideAccess: true }))
    await quiet(
      db().execute(sql`
        DELETE FROM audit_log
        WHERE created_at >= ${TEST_START}::timestamptz
          AND action IN ('data-retention.purge', 'data-retention.run', 'users.purge-unverified', 'events.purge', 'users.create-by-admin')`),
    )
    await quiet(payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'user-roles', where: { user: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }))
    await quiet(payload.delete({ collection: 'municipalities', id: muni.id, overrideAccess: true }))
  })

  it('removes an account that never verified, never finished onboarding and has nothing on it', async () => {
    expect(await exists(u.abandoned)).toBe(false)
    const profiles = await payload.count({ collection: 'profiles', where: { user: { equals: u.abandoned } }, overrideAccess: true })
    expect(profiles.totalDocs).toBe(0)
  })

  it('writes down that it did, without the address', async () => {
    const entries = await payload.find({
      collection: 'audit-log',
      where: { and: [{ action: { equals: 'users.purge-unverified' } }, { targetId: { equals: String(u.abandoned) } }] },
      depth: 0,
      overrideAccess: true,
    })
    expect(entries.docs).toHaveLength(1)
    expect(JSON.stringify(entries.docs[0])).not.toContain(`unverified-abandoned-${STAMP}`)
  })

  it('leaves a recent account alone — its owner may still be looking for the e-mail', async () => {
    expect(await exists(u.recent)).toBe(true)
  })

  it('leaves a verified account alone, however old', async () => {
    expect(await exists(u.verified)).toBe(true)
  })

  it('leaves an account that finished onboarding before the e-mail code existed', async () => {
    expect(await exists(u.legacy)).toBe(true)
  })

  it('leaves an account that was never sent a code — older accounts, or the e-mail failed', async () => {
    expect(await exists(u.neverSent)).toBe(true)
  })

  it('leaves an account a superadmin created', async () => {
    expect(await exists(u.staffCreated)).toBe(true)
  })

  it('leaves an account that holds a role', async () => {
    expect(await exists(u.withRole)).toBe(true)
  })

  it('a dry run only counts', async () => {
    const id = await makeUser('dry', { ageDays: 10 })
    const result = await processDataRetentionJob({ mode: 'dry-run' })
    expect(result.failed).toEqual([])
    expect(result.steps['unverified-accounts'].matched).toBeGreaterThanOrEqual(1)
    expect(result.steps['unverified-accounts'].deleted).toBe(0)
    expect(await exists(id)).toBe(true)
  })
})
