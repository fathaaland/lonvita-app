import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "billing_settings_licence_tiers" ALTER COLUMN "yearly_price_czk" DROP DEFAULT;
  ALTER TABLE "billing_settings_licence_tiers" ALTER COLUMN "yearly_price_czk" DROP NOT NULL;
  ALTER TABLE "billing_settings" ALTER COLUMN "implementation_fee_czk" DROP DEFAULT;
  ALTER TABLE "billing_settings" ALTER COLUMN "implementation_fee_czk" DROP NOT NULL;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_extra_source_price_czk" DROP DEFAULT;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_extra_source_price_czk" DROP NOT NULL;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_twice_weekly_price_czk" DROP DEFAULT;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_twice_weekly_price_czk" DROP NOT NULL;
  ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "population" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "population_year" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "contract_start" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "contract_years" numeric DEFAULT 2;
  ALTER TABLE "municipalities" ADD COLUMN "first_wave" boolean DEFAULT false;
  ALTER TABLE "municipalities" ADD COLUMN "reference_discount" boolean DEFAULT false;
  ALTER TABLE "municipalities" ADD COLUMN "price_index_percent" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "floor_exception_note" varchar;
  ALTER TABLE "municipalities" ADD COLUMN "trial_ends_at" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "trial_reminder_state" varchar;
  ALTER TABLE "municipalities" ADD COLUMN "licence_billed_tier" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "licence_billed_tier_period" varchar;
  ALTER TABLE "municipalities" ADD COLUMN "licence_next_tier" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "licence_next_tier_period" varchar;
  ALTER TABLE "municipalities" ADD COLUMN "licence_next_tier_users" numeric;
  ALTER TABLE "billing_settings_licence_tiers" ADD COLUMN "max_population" numeric;
  ALTER TABLE "billing_settings_licence_tiers" ADD COLUMN "floor_czk" numeric;
  ALTER TABLE "billing_settings_licence_tiers" ADD COLUMN "implementation_fee_czk" numeric;
  ALTER TABLE "billing_settings" ADD COLUMN "active_users_included_percent" numeric DEFAULT 5 NOT NULL;
  ALTER TABLE "billing_settings" ADD COLUMN "growth_cap_czk" numeric DEFAULT 200000 NOT NULL;
  ALTER TABLE "billing_settings" ADD COLUMN "three_year_discount_percent" numeric DEFAULT 5 NOT NULL;
  ALTER TABLE "billing_settings" ADD COLUMN "reference_implementation_discount_percent" numeric DEFAULT 50 NOT NULL;
  CREATE INDEX "users_last_seen_at_idx" ON "users" USING btree ("last_seen_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "billing_settings_licence_tiers" SET "yearly_price_czk" = 0 WHERE "yearly_price_czk" IS NULL;
   UPDATE "billing_settings" SET "implementation_fee_czk" = 5000 WHERE "implementation_fee_czk" IS NULL;
   UPDATE "billing_settings" SET "scraping_extra_source_price_czk" = 1500 WHERE "scraping_extra_source_price_czk" IS NULL;
   UPDATE "billing_settings" SET "scraping_twice_weekly_price_czk" = 2400 WHERE "scraping_twice_weekly_price_czk" IS NULL;
   DROP INDEX "users_last_seen_at_idx";
  ALTER TABLE "billing_settings_licence_tiers" ALTER COLUMN "yearly_price_czk" SET DEFAULT 0;
  ALTER TABLE "billing_settings_licence_tiers" ALTER COLUMN "yearly_price_czk" SET NOT NULL;
  ALTER TABLE "billing_settings" ALTER COLUMN "implementation_fee_czk" SET DEFAULT 5000;
  ALTER TABLE "billing_settings" ALTER COLUMN "implementation_fee_czk" SET NOT NULL;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_extra_source_price_czk" SET DEFAULT 1500;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_extra_source_price_czk" SET NOT NULL;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_twice_weekly_price_czk" SET DEFAULT 2400;
  ALTER TABLE "billing_settings" ALTER COLUMN "scraping_twice_weekly_price_czk" SET NOT NULL;
  ALTER TABLE "users" DROP COLUMN "last_seen_at";
  ALTER TABLE "municipalities" DROP COLUMN "population";
  ALTER TABLE "municipalities" DROP COLUMN "population_year";
  ALTER TABLE "municipalities" DROP COLUMN "contract_start";
  ALTER TABLE "municipalities" DROP COLUMN "contract_years";
  ALTER TABLE "municipalities" DROP COLUMN "first_wave";
  ALTER TABLE "municipalities" DROP COLUMN "reference_discount";
  ALTER TABLE "municipalities" DROP COLUMN "price_index_percent";
  ALTER TABLE "municipalities" DROP COLUMN "floor_exception_note";
  ALTER TABLE "municipalities" DROP COLUMN "trial_ends_at";
  ALTER TABLE "municipalities" DROP COLUMN "trial_reminder_state";
  ALTER TABLE "municipalities" DROP COLUMN "licence_billed_tier";
  ALTER TABLE "municipalities" DROP COLUMN "licence_billed_tier_period";
  ALTER TABLE "municipalities" DROP COLUMN "licence_next_tier";
  ALTER TABLE "municipalities" DROP COLUMN "licence_next_tier_period";
  ALTER TABLE "municipalities" DROP COLUMN "licence_next_tier_users";
  ALTER TABLE "billing_settings_licence_tiers" DROP COLUMN "max_population";
  ALTER TABLE "billing_settings_licence_tiers" DROP COLUMN "floor_czk";
  ALTER TABLE "billing_settings_licence_tiers" DROP COLUMN "implementation_fee_czk";
  ALTER TABLE "billing_settings" DROP COLUMN "active_users_included_percent";
  ALTER TABLE "billing_settings" DROP COLUMN "growth_cap_czk";
  ALTER TABLE "billing_settings" DROP COLUMN "three_year_discount_percent";
  ALTER TABLE "billing_settings" DROP COLUMN "reference_implementation_discount_percent";`)
}
