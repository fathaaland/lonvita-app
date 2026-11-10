import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Security events (sign-ins, failed ones, password resets, rate limits) are append-only in the
 * database itself, like the audit log (20261011_200000) — not only behind the API (SecurityEvents
 * access), because the same rows are copied each night to the write-once audit bucket and are the
 * trail of who got in:
 * - an UPDATE is never allowed — nothing writes one (the logger only inserts) and the table has no
 *   foreign keys that would need a SET NULL;
 * - a DELETE only takes entries at least 12 months old, which is what the data-retention job
 *   removes (RETENTION.securityEventMonths) — and only after the day was copied to the bucket;
 * - TRUNCATE not at all.
 * Exported for tests/int/security-events-guard.int.spec.ts, which installs it on the schema-pushed
 * dev database.
 */
export const SECURITY_EVENTS_GUARD_SQL = sql`
  CREATE OR REPLACE FUNCTION security_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'security_events is append-only: TRUNCATE is not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'security_events is append-only: entry % cannot be changed', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.created_at > now() - interval '12 months' THEN
      RAISE EXCEPTION 'security_events entry % is younger than 12 months and cannot be deleted', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END
  $$;
  DROP TRIGGER IF EXISTS security_events_guard ON security_events;
  CREATE TRIGGER security_events_guard BEFORE UPDATE OR DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION security_events_guard();
  DROP TRIGGER IF EXISTS security_events_guard_truncate ON security_events;
  CREATE TRIGGER security_events_guard_truncate BEFORE TRUNCATE ON security_events FOR EACH STATEMENT EXECUTE FUNCTION security_events_guard();
`

export const DROP_SECURITY_EVENTS_GUARD_SQL = sql`
  DROP TRIGGER IF EXISTS security_events_guard_truncate ON security_events;
  DROP TRIGGER IF EXISTS security_events_guard ON security_events;
  DROP FUNCTION IF EXISTS security_events_guard();
`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(SECURITY_EVENTS_GUARD_SQL)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(DROP_SECURITY_EVENTS_GUARD_SQL)
}
