import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "organizations" ADD COLUMN "description" varchar;`)
  // Existing organizations start from what their owner told the obec when asking for the organizer
  // role — the latest approved request in that obec.
  await db.execute(sql`
   UPDATE "organizations" o
   SET "description" = r."reason"
   FROM (
     SELECT DISTINCT ON ("user_id", "municipality_id") "user_id", "municipality_id", "reason"
     FROM "organizer_requests"
     WHERE "status" = 'approved' AND "reason" IS NOT NULL AND btrim("reason") <> ''
     ORDER BY "user_id", "municipality_id", "created_at" DESC
   ) r
   WHERE o."owner_id" = r."user_id" AND o."municipality_id" = r."municipality_id" AND o."description" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "organizations" DROP COLUMN "description";`)
}
