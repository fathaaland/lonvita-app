import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

import type { LogContext, LogSink, StoredLogEntry } from './index'
import type { Payload } from 'payload'

const text = (value: unknown, max = 1_000): string | null =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : null

const id = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null
}

/** The fields that get a column of their own; everything else of the line goes to `context`. */
const COLUMN_FIELDS = new Set([
  'event',
  'correlationId',
  'audit',
  'severity',
  'userId',
  'actorId',
  'userEmail',
  'ip',
  'ipAddress',
  'userAgent',
  'municipalityId',
  'outcome',
  'errorName',
  'errorMessage',
  'errorStack',
])

const contextOf = (fields: LogContext): string | null => {
  const rest = Object.fromEntries(Object.entries(fields).filter(([key]) => !COLUMN_FIELDS.has(key)))
  return Object.keys(rest).length > 0 ? JSON.stringify(rest) : null
}

const FAILURE_EVENT = /fail|reject|denied|exceeded|abandon|invalid|locked/

/** Said by the line when it knows (`outcome`), otherwise read off its event name and level. */
const outcomeOf = (entry: StoredLogEntry): 'success' | 'failure' => {
  const said = entry.fields.outcome
  if (said === 'success' || said === 'failure') return said
  if (entry.level === 'warn' || entry.level === 'error' || entry.level === 'fatal') return 'failure'
  return entry.event && FAILURE_EVENT.test(entry.event) ? 'failure' : 'success'
}

/**
 * Writes kept log lines into `system-logs` and `security-events` (see their collections). Plain SQL,
 * not the Local API: a Payload create would run the CRUD logging hook, which logs, which would
 * store again — and a log line needs none of what the hooks do.
 */
export const createDatabaseLogSink = (payload: Payload): LogSink => {
  const db = (payload.db as unknown as PostgresAdapter).drizzle

  return async (entry) => {
    const { fields } = entry
    const correlationId = text(fields.correlationId, 100)
    const userId = id(fields.userId ?? fields.actorId)
    const at = entry.timestamp

    if (entry.kind === 'security') {
      await db.execute(sql`
        INSERT INTO security_events
          (event, outcome, message, user_id, user_email, ip, user_agent, service, correlation_id,
           context, created_at, updated_at)
        VALUES (
          ${entry.event ?? 'security.unnamed'},
          ${outcomeOf(entry)}::enum_security_events_outcome,
          ${entry.message.slice(0, 1_000)},
          ${userId},
          ${text(fields.userEmail, 320)},
          ${text(fields.ip ?? fields.ipAddress, 100)},
          ${text(fields.userAgent, 300)},
          ${entry.service},
          ${correlationId},
          ${contextOf(fields)}::jsonb,
          ${at}::timestamptz,
          ${at}::timestamptz
        )`)
      return
    }

    await db.execute(sql`
      INSERT INTO system_logs
        (level, event, message, service, environment, correlation_id, user_id, municipality_id,
         error_name, error_message, error_stack, context, created_at, updated_at)
      VALUES (
        ${entry.level === 'debug' ? 'info' : entry.level}::enum_system_logs_level,
        ${entry.event},
        ${entry.message.slice(0, 1_000)},
        ${entry.service},
        ${entry.environment},
        ${correlationId},
        ${userId},
        ${id(fields.municipalityId)},
        ${text(fields.errorName, 200)},
        ${text(fields.errorMessage, 2_000)},
        ${text(fields.errorStack, 8_000)},
        ${contextOf(fields)}::jsonb,
        ${at}::timestamptz,
        ${at}::timestamptz
      )`)
  }
}
