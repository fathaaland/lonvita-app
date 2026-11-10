// @vitest-environment node
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import {
  DROP_SECURITY_EVENTS_GUARD_SQL,
  SECURITY_EVENTS_GUARD_SQL,
} from '@/migrations/20261110_120000_security_events_guard'

const STAMP = Date.now()
let payload: Payload
const db = () => (payload.db as unknown as PostgresAdapter).drizzle

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

const insertAged = async (age: string) =>
  Number(
    (
      await db().execute(sql`
        INSERT INTO security_events (event, outcome, message, created_at, updated_at)
        VALUES (${`auth.test.${STAMP}`}, 'success', 'guard test', now() - ${age}::interval, now())
        RETURNING id`)
    ).rows[0].id,
  )

describe('security_events is append-only in the database (migration 20261110_120000)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await db().execute(SECURITY_EVENTS_GUARD_SQL)
  })
  afterAll(async () => {
    await db().execute(DROP_SECURITY_EVENTS_GUARD_SQL)
    // The guard is gone again, so the old rows this test made can be cleaned up.
    await db().execute(sql`DELETE FROM security_events WHERE event = ${`auth.test.${STAMP}`}`)
  })

  it('lets a new entry in', async () => {
    const id = await insertAged('0 seconds')
    expect(id).toBeGreaterThan(0)
  })

  it('refuses to change an entry', async () => {
    const id = await insertAged('1 day')
    expect(await refusal(db().execute(sql`UPDATE security_events SET outcome = 'success', message = 'forged' WHERE id = ${id}`))).toMatch(
      /append-only/,
    )
  })

  it('refuses to delete an entry younger than 12 months, allows an older one', async () => {
    const young = await insertAged('11 months')
    const old = await insertAged('13 months')
    expect(await refusal(db().execute(sql`DELETE FROM security_events WHERE id = ${young}`))).toMatch(/younger than 12 months/)
    await db().execute(sql`DELETE FROM security_events WHERE id = ${old}`)
    const left = await db().execute(sql`SELECT id FROM security_events WHERE id IN (${young}, ${old})`)
    expect(left.rows.map((r) => Number(r.id))).toEqual([young])
  })

  it('refuses TRUNCATE, even the CASCADE that gets past the foreign keys', async () => {
    // Inside a transaction that's rolled back whatever happens — this runs on the shared dev database.
    const outcome = await refusal(
      db().transaction(async (tx) => {
        await tx.execute(sql`TRUNCATE security_events CASCADE`)
        throw new Error('truncated — rolled back')
      }),
    )
    expect(outcome).toMatch(/TRUNCATE is not allowed/)
  })
})
