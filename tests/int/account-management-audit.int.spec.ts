// @vitest-environment node
import { createLocalReq, getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Account management by the platform admin is on the audit record (vyhláška č. 409/2025 Sb. § 22
// odst. 3) — not only in the console: an edit of a user in the Payload admin, a password set for
// someone, an unlocked account, a change of the import switches.

let payload: Payload
const STAMP = Date.now()
let admin: { id: number; role?: string | null; email: string }
let target: { id: number; email: string }

/** What the Payload admin sends — the REST API, as the signed-in superadmin. */
const restReq = () =>
  createLocalReq({ user: admin as never, req: { payloadAPI: 'REST' } as never }, payload)

const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

const entries = async (action: string, targetId: number | string) =>
  (
    await payload.find({
      collection: 'audit-log',
      where: { and: [{ action: { equals: action } }, { targetId: { equals: String(targetId) } }] },
      overrideAccess: true,
      depth: 0,
    })
  ).docs

describe('account management audit', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
    admin = (await payload.create({
      collection: 'users',
      data: { email: `audit-admin-${STAMP}@test.local`, password: 'test12345678', role: 'admin' },
      overrideAccess: true,
    })) as typeof admin
    target = (await payload.create({
      collection: 'users',
      data: { email: `audit-target-${STAMP}@test.local`, password: 'test12345678', role: 'user' },
      overrideAccess: true,
    })) as typeof target
  })

  afterAll(async () => {
    // Audit entries stay (the database refuses to delete them); the users may go.
    await payload
      .delete({ collection: 'users', id: target.id, overrideAccess: true })
      .catch(() => undefined)
  })

  it('records which fields an admin changed — names, not values', async () => {
    const newEmail = `audit-target-renamed-${STAMP}@test.local`
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { email: newEmail },
      overrideAccess: false,
      req: await restReq(),
    })
    await settle()
    const [entry] = await entries('users.update', target.id)
    expect(entry).toBeDefined()
    expect(entry.metadata).toMatchObject({ changedFields: ['email'], passwordSet: false })
    expect(JSON.stringify(entry.metadata)).not.toContain(newEmail)
  })

  it('records a password set by an admin', async () => {
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { password: 'another-password-123' },
      overrideAccess: false,
      req: await restReq(),
    })
    await settle()
    expect(await entries('users.password-set-by-admin', target.id)).toHaveLength(1)
  })

  it("leaves the app's own Local API changes to their own entries", async () => {
    const before = (await entries('users.update', target.id)).length
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { email: `audit-local-${STAMP}@test.local` },
      overrideAccess: true,
    })
    await settle()
    expect(await entries('users.update', target.id)).toHaveLength(before)
  })

  it('records an unlock', async () => {
    const user = await payload.findByID({
      collection: 'users',
      id: target.id,
      overrideAccess: true,
    })
    await payload.unlock({
      collection: 'users',
      data: { email: user.email } as never,
      overrideAccess: false,
      req: await restReq(),
    })
    await settle()
    expect(await entries('users.unlock', target.id)).toHaveLength(1)
  })

  it('records a change of the import settings', async () => {
    const req = await restReq()
    const current = await payload.findGlobal({ slug: 'import-settings', overrideAccess: true })
    await payload.updateGlobal({
      slug: 'import-settings',
      data: { aiEnabled: !current.aiEnabled },
      overrideAccess: false,
      req,
    })
    await payload.updateGlobal({
      slug: 'import-settings',
      data: { aiEnabled: current.aiEnabled },
      overrideAccess: true,
    })
    await settle()
    const changes = await entries('import-settings.update', 'global')
    expect(
      changes.some(
        (e) => Number(e.actor) === admin.id || (e.actor as { id?: number })?.id === admin.id,
      ),
    ).toBe(true)
  })
})
