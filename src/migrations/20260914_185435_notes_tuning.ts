import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "profiles" ALTER COLUMN "municipality_id" DROP NOT NULL;
  ALTER TABLE "notifications" ADD COLUMN "link" varchar;`)

  // Data: municipalities.admin_user_id was never written by the superadmin panel (it only created
  // user_roles rows) — backfill it with the most recently granted municipality_admin, the same rule
  // UserRoles' sync hook applies from now on.
  await db.execute(sql`
   UPDATE "municipalities" m SET "admin_user_id" = (
     SELECT r."user_id" FROM "user_roles" r
     WHERE r."municipality_id" = m."id" AND r."role" = 'municipality_admin'
     ORDER BY r."created_at" DESC LIMIT 1
   );`)

  // Data: an organizer no longer registers for their own event (they take part automatically and
  // don't use up a participant's spot) — cancel the self-registrations created before that rule.
  await db.execute(sql`
   UPDATE "registrations" r SET "status" = 'cancelled', "updated_at" = now()
   FROM "events" e
   WHERE r."event_id" = e."id" AND r."user_id" = e."organizer_id" AND r."status" <> 'cancelled';`)
}

// The data backfills in `up` aren't reverted — they only correct existing rows.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "profiles" ALTER COLUMN "municipality_id" SET NOT NULL;
  ALTER TABLE "notifications" DROP COLUMN "link";`)
}
