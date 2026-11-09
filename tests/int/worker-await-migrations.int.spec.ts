import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { awaitMigrations, expectedMigration } from '../../worker/src/runtime/await-migrations'

// The worker takes no job until the database has the newest migration its code was written for —
// Vercel migrates in its own build, Railway may start the worker first.

let payload: Payload
const execute = (query: ReturnType<typeof sql>) =>
  (payload.db as unknown as PostgresAdapter).drizzle.execute(query)

const name = expectedMigration()!
const hasRow = async () =>
  (await execute(sql`SELECT 1 FROM payload_migrations WHERE name = ${name}`)).rows.length > 0
const addRow = () =>
  execute(
    sql`INSERT INTO payload_migrations (name, batch, updated_at, created_at) VALUES (${name}, 1, now(), now())`,
  )
const removeRow = () => execute(sql`DELETE FROM payload_migrations WHERE name = ${name}`)

describe('worker waits for the database migration', () => {
  // The test database may be schema-pushed (no migration rows) or migrated — leave it as found.
  let hadRow = false

  beforeAll(async () => {
    payload = await getPayload({ config })
    hadRow = await hasRow()
  })

  afterAll(async () => {
    const has = await hasRow()
    if (hadRow && !has) await addRow()
    if (!hadRow && has) await removeRow()
  })

  it('keeps waiting while the newest migration is missing, and goes on once it lands', async () => {
    await removeRow()
    let done = false
    const waiting = awaitMigrations({ pollMs: 50 }).then(() => {
      done = true
    })

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(done).toBe(false)

    await addRow()
    await waiting
    expect(done).toBe(true)
  })

  it('returns at once when the newest migration is there', async () => {
    if (!(await hasRow())) await addRow()
    await expect(awaitMigrations({ pollMs: 60_000 })).resolves.toBeUndefined()
  })

  it('is skipped with WORKER_AWAIT_MIGRATIONS=false', async () => {
    await removeRow()
    vi.stubEnv('WORKER_AWAIT_MIGRATIONS', 'false')
    try {
      await expect(awaitMigrations({ pollMs: 60_000 })).resolves.toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
