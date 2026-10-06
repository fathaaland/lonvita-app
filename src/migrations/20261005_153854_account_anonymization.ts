import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp(3) with time zone;
  ALTER TABLE "profiles" ADD COLUMN "over50" boolean;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN "anonymized_at";
  ALTER TABLE "profiles" DROP COLUMN "over50";`)
}
