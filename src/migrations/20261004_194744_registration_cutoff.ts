import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "registrations" ADD COLUMN "excuse_message" varchar;
  ALTER TABLE "registrations" ADD COLUMN "cancelled_at" timestamp(3) with time zone;
  ALTER TABLE "events" DROP COLUMN "cancellation_policy";
  DROP TYPE "public"."enum_events_cancellation_policy";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_events_cancellation_policy" AS ENUM('none', 'cancel_24h', 'cancel_48h', 'cancel_7d');
  ALTER TABLE "events" ADD COLUMN "cancellation_policy" "enum_events_cancellation_policy" DEFAULT 'cancel_48h' NOT NULL;
  ALTER TABLE "registrations" DROP COLUMN "excuse_message";
  ALTER TABLE "registrations" DROP COLUMN "cancelled_at";`)
}
