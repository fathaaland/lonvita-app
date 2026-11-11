import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'
import { APIError } from 'payload'

/**
 * Locks one row for the rest of `req`'s transaction (SELECT … FOR UPDATE) — so two people deciding
 * the same request at once don't each read the old state and overwrite the other's answer. A no-op
 * outside a transaction; says whether it locked.
 */
export async function lockRow(req: PayloadRequest, table: string, id: number | string): Promise<boolean> {
  if (!req.transactionID) return false
  const db = req.payload.db as unknown as { sessions?: Record<string, { db?: { execute: (q: unknown) => Promise<unknown> } }> }
  const session = db.sessions?.[String(await req.transactionID)]?.db
  if (!session) return false
  await session.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${Number(id)} FOR UPDATE`)
  return true
}

/**
 * `lockRow` where going on without the lock would be wrong — a capacity count. The transaction can be
 * gone by then: any nested Payload call on this `req` that fails rolls the whole transaction back and
 * drops it from `req` (killTransaction), and a caller that catches that error carries on with
 * autocommitted writes. Counting places then is counting without the lock, and a rush overbooks.
 * Refused instead: the client may simply try again.
 */
export async function lockRowOrRefuse(req: PayloadRequest, table: string, id: number | string): Promise<void> {
  if (await lockRow(req, table, id)) return
  req.payload.logger.error({ msg: `lockRowOrRefuse: no transaction to lock ${table} ${id} in`, event: 'db.lock_without_transaction' })
  throw new APIError('Přihlašování je právě přetížené — zkuste to prosím za chvíli znovu.', 503)
}
