import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

/**
 * Locks one row for the rest of `req`'s transaction (SELECT … FOR UPDATE) — so two people deciding
 * the same request at once don't each read the old state and overwrite the other's answer. A no-op
 * outside a transaction.
 */
export async function lockRow(req: PayloadRequest, table: string, id: number | string): Promise<void> {
  if (!req.transactionID) return
  const db = req.payload.db as unknown as { sessions?: Record<string, { db?: { execute: (q: unknown) => Promise<unknown> } }> }
  const session = db.sessions?.[String(await req.transactionID)]?.db
  if (!session) return
  await session.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${Number(id)} FOR UPDATE`)
}
