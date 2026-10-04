import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_co_organizing_requests_status" ADD VALUE 'expired';
  ALTER TYPE "public"."enum_event_deletion_requests_status" ADD VALUE 'requester-removed';
  ALTER TYPE "public"."enum_event_deletion_requests_status" ADD VALUE 'escalated';
  ALTER TYPE "public"."enum_event_deletion_requests_status" ADD VALUE 'escalation-rejected';
  ALTER TABLE "co_organizing_requests" ADD COLUMN "expires_at" timestamp(3) with time zone;
  UPDATE "co_organizing_requests" SET "expires_at" = "created_at" + interval '24 hours';
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "expires_at" SET NOT NULL;
  ALTER TABLE "event_deletion_requests" ADD COLUMN "rejected_by_id" integer;
  ALTER TABLE "event_deletion_requests" ADD COLUMN "escalated_at" timestamp(3) with time zone;
  ALTER TABLE "event_deletion_requests" ADD COLUMN "successor_id" integer;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_successor_id_users_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "event_deletion_requests_rejected_by_idx" ON "event_deletion_requests" USING btree ("rejected_by_id");
  CREATE INDEX "event_deletion_requests_successor_idx" ON "event_deletion_requests" USING btree ("successor_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "co_organizing_requests" SET "status" = 'rejected' WHERE "status" = 'expired';
  UPDATE "event_deletion_requests" SET "status" = 'rejected' WHERE "status" IN ('requester-removed', 'escalated', 'escalation-rejected');
   ALTER TABLE "event_deletion_requests" DROP CONSTRAINT "event_deletion_requests_rejected_by_id_users_id_fk";
  
  ALTER TABLE "event_deletion_requests" DROP CONSTRAINT "event_deletion_requests_successor_id_users_id_fk";
  
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_co_organizing_requests_status";
  CREATE TYPE "public"."enum_co_organizing_requests_status" AS ENUM('pending', 'approved', 'rejected');
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_co_organizing_requests_status";
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "status" SET DATA TYPE "public"."enum_co_organizing_requests_status" USING "status"::"public"."enum_co_organizing_requests_status";
  ALTER TABLE "event_deletion_requests" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "event_deletion_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_event_deletion_requests_status";
  CREATE TYPE "public"."enum_event_deletion_requests_status" AS ENUM('pending', 'approved', 'rejected', 'expired');
  ALTER TABLE "event_deletion_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_event_deletion_requests_status";
  ALTER TABLE "event_deletion_requests" ALTER COLUMN "status" SET DATA TYPE "public"."enum_event_deletion_requests_status" USING "status"::"public"."enum_event_deletion_requests_status";
  DROP INDEX "event_deletion_requests_rejected_by_idx";
  DROP INDEX "event_deletion_requests_successor_idx";
  ALTER TABLE "co_organizing_requests" DROP COLUMN "expires_at";
  ALTER TABLE "event_deletion_requests" DROP COLUMN "rejected_by_id";
  ALTER TABLE "event_deletion_requests" DROP COLUMN "escalated_at";
  ALTER TABLE "event_deletion_requests" DROP COLUMN "successor_id";`)
}
