import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * The audit log is append-only in the database itself, not only behind the API (AuditLog access):
 * - an UPDATE may only null a foreign key whose user or obec was deleted (ON DELETE SET NULL);
 * - a DELETE only takes entries at least 18 months old (vyhláška č. 409/2025 Sb. § 22 odst. 5
 *   písm. c; RETENTION.auditLogMinimumMonths) — the data-retention job removes them at 36;
 * - TRUNCATE not at all.
 * Exported for tests/int/data-retention.int.spec.ts, which installs it on the schema-pushed dev database.
 */
export const AUDIT_LOG_GUARD_SQL = sql`
  CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF (to_jsonb(NEW) - 'actor_id' - 'municipality_id') IS DISTINCT FROM (to_jsonb(OLD) - 'actor_id' - 'municipality_id')
        OR (NEW.actor_id IS NOT NULL AND NEW.actor_id IS DISTINCT FROM OLD.actor_id)
        OR (NEW.municipality_id IS NOT NULL AND NEW.municipality_id IS DISTINCT FROM OLD.municipality_id) THEN
        RAISE EXCEPTION 'audit_log is append-only: entry % cannot be changed', OLD.id USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.created_at > now() - interval '18 months' THEN
      RAISE EXCEPTION 'audit_log entry % is younger than 18 months and cannot be deleted', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END
  $$;
  DROP TRIGGER IF EXISTS audit_log_guard ON audit_log;
  CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
  DROP TRIGGER IF EXISTS audit_log_guard_truncate ON audit_log;
  CREATE TRIGGER audit_log_guard_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();
`

export const DROP_AUDIT_LOG_GUARD_SQL = sql`
  DROP TRIGGER IF EXISTS audit_log_guard_truncate ON audit_log;
  DROP TRIGGER IF EXISTS audit_log_guard ON audit_log;
  DROP FUNCTION IF EXISTS audit_log_guard();
`

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_audit_log_outcome" AS ENUM('success', 'failure');
  ALTER TABLE "audit_log" ADD COLUMN "outcome" "enum_audit_log_outcome" DEFAULT 'success' NOT NULL;
  ALTER TABLE "audit_log" ADD COLUMN "ip_address" varchar;
  ALTER TABLE "audit_log" ADD COLUMN "user_agent" varchar;
  ALTER TABLE "audit_log" ADD COLUMN "correlation_id" varchar;
  CREATE INDEX "events_date_time_idx" ON "events" USING btree ("date_time");
  CREATE INDEX "events_status_idx" ON "events" USING btree ("status");
  CREATE INDEX "events_deleted_at_idx" ON "events" USING btree ("deleted_at");
  CREATE INDEX "events_municipality_date_time_idx" ON "events" USING btree ("municipality_id","date_time");
  CREATE INDEX "registrations_status_idx" ON "registrations" USING btree ("status");
  CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");
  CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");
  CREATE INDEX "notifications_user_read_at_idx" ON "notifications" USING btree ("user_id","read_at");
  CREATE INDEX "organizer_requests_status_idx" ON "organizer_requests" USING btree ("status");
  CREATE INDEX "co_organizing_requests_status_idx" ON "co_organizing_requests" USING btree ("status");
  CREATE INDEX "co_organizing_requests_expires_at_idx" ON "co_organizing_requests" USING btree ("expires_at");
  CREATE INDEX "event_deletion_requests_status_idx" ON "event_deletion_requests" USING btree ("status");
  CREATE INDEX "event_deletion_requests_expires_at_idx" ON "event_deletion_requests" USING btree ("expires_at");
  CREATE INDEX "volunteer_invitations_status_idx" ON "volunteer_invitations" USING btree ("status");
  CREATE INDEX "pool_invitations_status_idx" ON "pool_invitations" USING btree ("status");`)
  await db.execute(AUDIT_LOG_GUARD_SQL)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(DROP_AUDIT_LOG_GUARD_SQL)
  await db.execute(sql`
   DROP INDEX "events_date_time_idx";
  DROP INDEX "events_status_idx";
  DROP INDEX "events_deleted_at_idx";
  DROP INDEX "events_municipality_date_time_idx";
  DROP INDEX "registrations_status_idx";
  DROP INDEX "audit_log_action_idx";
  DROP INDEX "notifications_read_at_idx";
  DROP INDEX "notifications_user_read_at_idx";
  DROP INDEX "organizer_requests_status_idx";
  DROP INDEX "co_organizing_requests_status_idx";
  DROP INDEX "co_organizing_requests_expires_at_idx";
  DROP INDEX "event_deletion_requests_status_idx";
  DROP INDEX "event_deletion_requests_expires_at_idx";
  DROP INDEX "volunteer_invitations_status_idx";
  DROP INDEX "pool_invitations_status_idx";
  ALTER TABLE "audit_log" DROP COLUMN "outcome";
  ALTER TABLE "audit_log" DROP COLUMN "ip_address";
  ALTER TABLE "audit_log" DROP COLUMN "user_agent";
  ALTER TABLE "audit_log" DROP COLUMN "correlation_id";
  DROP TYPE "public"."enum_audit_log_outcome";`)
}
