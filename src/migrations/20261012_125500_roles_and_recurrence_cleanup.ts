import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * - events.recurrence_rule: no screen ever set it and nothing generated occurrences from it. The
 *   migration stops — rolling back, failing the deploy — if any event holds one after all.
 * - municipalities.admin_user_id: a copy of the "municipality_admin" user-roles, kept in sync by
 *   hooks both ways; who administers an obec is read from the roles now.
 * - the "participant" user-role: where someone lives is Profiles.municipality; a role is what they
 *   may do there. Its rows go first (the enum can't be narrowed while they're in it), and the audit
 *   log records how many.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  const { rows } = await db.execute(sql`SELECT count(*) AS n FROM events WHERE coalesce(recurrence_rule, '') <> ''`)
  const withRecurrence = Number((rows[0] as { n: number | string }).n)
  if (withRecurrence > 0) {
    throw new Error(
      `Cleanup stopped — ${withRecurrence} event(s) still hold a recurrence_rule. Keep it elsewhere or confirm it can go before running this migration.`,
    )
  }

  const removed = await db.execute(sql`DELETE FROM "user_roles" WHERE "role" = 'participant' RETURNING id`)
  await db.execute(sql`
    INSERT INTO "audit_log" ("action", "target_collection", "target_id", "metadata")
    VALUES ('user-roles.participant-removed', 'user-roles', 'migration:20261012_125500',
            ${JSON.stringify({ count: removed.rows.length, reason: 'residence is Profiles.municipality, not a role' })}::jsonb)
  `)

  await db.execute(sql`
   ALTER TABLE "municipalities" DROP CONSTRAINT "municipalities_admin_user_id_users_id_fk";
  
  ALTER TABLE "user_roles" ALTER COLUMN "role" SET DATA TYPE text;
  DROP TYPE "public"."enum_user_roles_role";
  CREATE TYPE "public"."enum_user_roles_role" AS ENUM('municipality_admin', 'organizer', 'prescriber');
  ALTER TABLE "user_roles" ALTER COLUMN "role" SET DATA TYPE "public"."enum_user_roles_role" USING "role"::"public"."enum_user_roles_role";
  DROP INDEX "municipalities_admin_user_idx";
  ALTER TABLE "municipalities" DROP COLUMN "admin_user_id";
  ALTER TABLE "events" DROP COLUMN "recurrence_rule";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_user_roles_role" ADD VALUE 'participant' BEFORE 'municipality_admin';
  ALTER TABLE "municipalities" ADD COLUMN "admin_user_id" integer;
  ALTER TABLE "events" ADD COLUMN "recurrence_rule" varchar;
  ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "municipalities_admin_user_idx" ON "municipalities" USING btree ("admin_user_id");`)
}
