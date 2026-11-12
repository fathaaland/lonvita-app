import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "billing_settings" ADD COLUMN "scraping_extra_source_price_czk" numeric DEFAULT 1500 NOT NULL;
  ALTER TABLE "billing_settings" ADD COLUMN "scraping_twice_weekly_price_czk" numeric DEFAULT 2400 NOT NULL;
  ALTER TABLE "billing_settings" ADD COLUMN "scraping_cost_alert_usd_per_source" numeric DEFAULT 0.5 NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "billing_settings" DROP COLUMN "scraping_extra_source_price_czk";
  ALTER TABLE "billing_settings" DROP COLUMN "scraping_twice_weekly_price_czk";
  ALTER TABLE "billing_settings" DROP COLUMN "scraping_cost_alert_usd_per_source";`)
}
