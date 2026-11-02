import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Step 2 of retiring the flat monthly service prices (replaced by the yearly packages, migration
 * 20261102_155104_billing_packages): the code that read these columns is gone since the previous
 * deploy. Their values (old monthly prices, the USD AI limit) are intentionally discarded.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "municipalities" DROP COLUMN IF EXISTS "import_ai_budget_usd";
  ALTER TABLE "municipalities" DROP COLUMN IF EXISTS "email_price_czk";
  ALTER TABLE "municipalities" DROP COLUMN IF EXISTS "sms_price_czk";
  ALTER TABLE "municipalities" DROP COLUMN IF EXISTS "sms_monthly_limit";
  ALTER TABLE "municipalities" DROP COLUMN IF EXISTS "import_ai_price_czk";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "municipalities" ADD COLUMN IF NOT EXISTS "import_ai_budget_usd" numeric;
  ALTER TABLE "municipalities" ADD COLUMN IF NOT EXISTS "email_price_czk" numeric;
  ALTER TABLE "municipalities" ADD COLUMN IF NOT EXISTS "sms_price_czk" numeric;
  ALTER TABLE "municipalities" ADD COLUMN IF NOT EXISTS "sms_monthly_limit" numeric;
  ALTER TABLE "municipalities" ADD COLUMN IF NOT EXISTS "import_ai_price_czk" numeric;`)
}
