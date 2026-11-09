import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import { logger, serializeError } from '@/lib/logger'
import { migrations } from '@/migrations'

import { getWorkerPayload } from './payload'

const POLL_MS = 15_000
/** Past this the wait is an incident (the Vercel build failed, or migrated another database) — alerted once. */
const ALERT_AFTER_MS = 15 * 60_000

/** The newest migration this build of the worker was written against. */
export const expectedMigration = (): string | undefined => migrations.at(-1)?.name

/**
 * Railway and Vercel deploy the same commit independently, and only the Vercel build migrates
 * (scripts/vercel-build.sh). A worker that starts first would run its jobs against the old schema —
 * a missing table or column fails them, and the main queue's three quick tries are gone before the
 * migration lands. So the worker takes no job until the database has its newest migration: jobs wait
 * in Redis meanwhile, nothing is lost.
 *
 * WORKER_AWAIT_MIGRATIONS=false skips it — a local database built by `pnpm dev` (schema push) has no
 * migration rows to find.
 */
export async function awaitMigrations({
  pollMs = POLL_MS,
}: { pollMs?: number } = {}): Promise<void> {
  const expected = expectedMigration()
  if (!expected || process.env.WORKER_AWAIT_MIGRATIONS?.trim().toLowerCase() === 'false') return

  const payload = await getWorkerPayload()
  const db = (payload.db as unknown as PostgresAdapter).drizzle
  const startedAt = Date.now()
  let alerted = false
  let announced = false

  // A SIGTERM meanwhile is handled by runtime/shutdown, which exits the process.
  for (;;) {
    try {
      const { rows } = await db.execute(
        sql`SELECT 1 FROM payload_migrations WHERE name = ${expected} LIMIT 1`,
      )
      if (rows.length > 0) {
        if (announced) {
          logger.info('Database migrated — worker taking jobs', {
            event: 'worker.migrations_ready',
            migration: expected,
            waitedSeconds: Math.round((Date.now() - startedAt) / 1000),
          })
        }
        return
      }
    } catch (error) {
      // No payload_migrations at all (an empty database) reads the same as "not migrated yet".
      logger.warn('Migration check failed', {
        event: 'worker.migrations_check_failed',
        ...serializeError(error),
      })
    }

    if (!announced) {
      announced = true
      logger.warn('Waiting for the database migration before taking jobs', {
        event: 'worker.migrations_pending',
        migration: expected,
      })
    }
    if (!alerted && Date.now() - startedAt > ALERT_AFTER_MS) {
      alerted = true
      logger.fatal('Worker still waiting for a database migration — no jobs are processed', {
        event: 'worker.migrations_pending_too_long',
        migration: expected,
        waitedMinutes: Math.round((Date.now() - startedAt) / 60_000),
      })
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
