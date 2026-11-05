import type { Payload, PayloadRequest } from 'payload'

import { logger } from '@/lib/logger'
import { serializeError } from '@/lib/logger/serialize-error'

type Task = () => Promise<unknown> | unknown

/** Work waiting on a transaction, by its id — run once it commits, dropped if it rolls back. */
const pending = new Map<string, { req: PayloadRequest; tasks: Task[] }>()

const installed = new WeakSet<object>()

const run = async (tasks: Task[] | undefined) => {
  for (const task of tasks ?? []) {
    try {
      await task()
    } catch (error) {
      logger.error('After-commit task failed', { event: 'after_commit.failed', ...serializeError(error) })
    }
  }
}

/**
 * Runs `task` once the transaction `req` is in has committed — straight away when there is none.
 *
 * For what leaves the database: e-mails, SMS and in-app notifications queued, live updates
 * published. Inside the transaction they would tell people about a change that may still roll back,
 * hold the row locks (and the connection) while Redis answers, and — written without `req` — take a
 * second connection from the pool per request. Never throws; a failed task is logged.
 */
export async function afterCommit(req: PayloadRequest | undefined, task: Task): Promise<void> {
  const id = req?.transactionID ? await req.transactionID : undefined
  if (id === undefined || id === null || !installed.has(req!.payload.db)) {
    await run([task])
    return
  }
  const key = String(id)
  const entry = pending.get(key)
  if (entry) entry.tasks.push(task)
  else pending.set(key, { req: req!, tasks: [task] })
}

/**
 * `afterCommit` around a whole afterChange hook — for hooks whose every effect leaves the database
 * (notifications, e-mails, queued reminders). The hook still sees the same `doc`, `previousDoc`,
 * `context` and `req`, only later; reads through `req` see the committed data.
 */
export const deferredUntilCommit =
  <Args extends { req: PayloadRequest; doc: Doc }, Doc>(hook: (args: Args) => Promise<unknown> | unknown) =>
  async (args: Args): Promise<Doc> => {
    await afterCommit(args.req, () => hook(args))
    return args.doc
  }

/** Hooks the database adapter's commit and rollback so `afterCommit` knows when to run or drop its
 * tasks. Once per Payload instance (onInit); idempotent. */
export function installAfterCommit(payload: Payload): void {
  const db = payload.db as Payload['db'] & {
    commitTransaction: (id: number | Promise<number | string> | string) => Promise<void>
    rollbackTransaction: (id: number | Promise<number | string> | string) => Promise<void>
  }
  if (installed.has(db)) return
  installed.add(db)

  const commit = db.commitTransaction.bind(db)
  const rollback = db.rollbackTransaction.bind(db)

  db.commitTransaction = async (id) => {
    const key = String(await id)
    try {
      await commit(id)
    } catch (error) {
      pending.delete(key)
      throw error
    }
    const entry = pending.get(key)
    pending.delete(key)
    if (!entry) return
    // Payload drops it right after this returns; done first so a task writing through `req` opens a
    // transaction of its own instead of reaching for the committed one.
    delete entry.req.transactionID
    // Awaited, not fire-and-forget: a serverless function may be frozen the moment its response
    // goes out, and the locks are already released here.
    await run(entry.tasks)
  }
  db.rollbackTransaction = async (id) => {
    pending.delete(String(await id))
    await rollback(id)
  }
}
