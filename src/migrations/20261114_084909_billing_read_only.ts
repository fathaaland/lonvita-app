import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_municipalities_billing_status" ADD VALUE 'read_only';
  ALTER TABLE "municipalities" ADD COLUMN "billing_status_changed_at" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "billing_warned_at" timestamp(3) with time zone;
  -- Obce already suspended: their 30-day grace period starts now.
  UPDATE "municipalities" SET "billing_status_changed_at" = now() WHERE "billing_status" = 'suspended';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "municipalities" SET "billing_status" = 'suspended' WHERE "billing_status" = 'read_only';
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DATA TYPE text;
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DEFAULT 'active'::text;
  DROP TYPE "public"."enum_municipalities_billing_status";
  CREATE TYPE "public"."enum_municipalities_billing_status" AS ENUM('active', 'suspended');
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DEFAULT 'active'::"public"."enum_municipalities_billing_status";
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DATA TYPE "public"."enum_municipalities_billing_status" USING "billing_status"::"public"."enum_municipalities_billing_status";
  ALTER TABLE "municipalities" DROP COLUMN "billing_status_changed_at";
  ALTER TABLE "municipalities" DROP COLUMN "billing_warned_at";`)
}
