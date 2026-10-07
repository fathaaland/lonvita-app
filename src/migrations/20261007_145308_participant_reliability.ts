import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "registrations" ADD COLUMN "self_cancelled" boolean DEFAULT false;`)
  // Only a registrant ever writes an omluvenka with their own cancellation — those are certainly
  // theirs. Earlier cancellations without one can't be told apart from internal ones, so stay out.
  await db.execute(sql`
   UPDATE "registrations" SET "self_cancelled" = true WHERE "status" = 'cancelled' AND "excuse_message" IS NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "registrations" DROP COLUMN "self_cancelled";`)
}
