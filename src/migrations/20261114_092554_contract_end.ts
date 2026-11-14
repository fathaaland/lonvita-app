import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_municipalities_billing_status" ADD VALUE 'terminated';
  ALTER TYPE "public"."enum_exports_kind" ADD VALUE 'municipality-archive';
  ALTER TYPE "public"."enum_exports_format" ADD VALUE 'zip';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "municipalities" SET "billing_status" = 'read_only' WHERE "billing_status" = 'terminated';
  DELETE FROM "exports" WHERE "kind" = 'municipality-archive' OR "format" = 'zip';
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DATA TYPE text;
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DEFAULT 'active'::text;
  DROP TYPE "public"."enum_municipalities_billing_status";
  CREATE TYPE "public"."enum_municipalities_billing_status" AS ENUM('active', 'suspended', 'read_only');
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DEFAULT 'active'::"public"."enum_municipalities_billing_status";
  ALTER TABLE "municipalities" ALTER COLUMN "billing_status" SET DATA TYPE "public"."enum_municipalities_billing_status" USING "billing_status"::"public"."enum_municipalities_billing_status";
  ALTER TABLE "exports" ALTER COLUMN "kind" SET DATA TYPE text;
  DROP TYPE "public"."enum_exports_kind";
  CREATE TYPE "public"."enum_exports_kind" AS ENUM('community-report', 'organization-report', 'municipality-events');
  ALTER TABLE "exports" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_exports_kind" USING "kind"::"public"."enum_exports_kind";
  ALTER TABLE "exports" ALTER COLUMN "format" SET DATA TYPE text;
  DROP TYPE "public"."enum_exports_format";
  CREATE TYPE "public"."enum_exports_format" AS ENUM('docx', 'pdf', 'csv');
  ALTER TABLE "exports" ALTER COLUMN "format" SET DATA TYPE "public"."enum_exports_format" USING "format"::"public"."enum_exports_format";`)
}
