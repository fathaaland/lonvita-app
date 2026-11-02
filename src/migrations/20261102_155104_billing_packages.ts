import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_municipalities_billing_status" AS ENUM('active', 'suspended');
  CREATE TYPE "public"."enum_municipalities_sms_package" AS ENUM('s', 'm', 'l');
  CREATE TYPE "public"."enum_municipalities_scraping_package" AS ENUM('s', 'm', 'l');
  CREATE TYPE "public"."enum_municipalities_scraping_frequency" AS ENUM('weekly', 'twice_weekly');
  CREATE TYPE "public"."enum_import_runs_review_status" AS ENUM('ok', 'problem');
  CREATE TABLE "active_user_snapshots" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"month" varchar NOT NULL,
  	"active_users" numeric NOT NULL,
  	"taken_at" timestamp(3) with time zone NOT NULL,
  	"taken_by_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "billing_settings_licence_tiers" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"max_users" numeric,
  	"yearly_price_czk" numeric DEFAULT 0 NOT NULL
  );
  
  CREATE TABLE "billing_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"implementation_fee_czk" numeric DEFAULT 5000 NOT NULL,
  	"sms_packages_s_quota" numeric DEFAULT 1200 NOT NULL,
  	"sms_packages_s_yearly_price_czk" numeric DEFAULT 3600 NOT NULL,
  	"sms_packages_m_quota" numeric DEFAULT 3600 NOT NULL,
  	"sms_packages_m_yearly_price_czk" numeric DEFAULT 9000 NOT NULL,
  	"sms_packages_l_quota" numeric DEFAULT 12000 NOT NULL,
  	"sms_packages_l_yearly_price_czk" numeric DEFAULT 26400 NOT NULL,
  	"sms_overage_price_czk" numeric DEFAULT 2.5 NOT NULL,
  	"scraping_packages_s_max_sources" numeric DEFAULT 3 NOT NULL,
  	"scraping_packages_s_yearly_price_czk" numeric DEFAULT 5400 NOT NULL,
  	"scraping_packages_m_max_sources" numeric DEFAULT 10 NOT NULL,
  	"scraping_packages_m_yearly_price_czk" numeric DEFAULT 12000 NOT NULL,
  	"scraping_packages_l_max_sources" numeric DEFAULT 25 NOT NULL,
  	"scraping_packages_l_yearly_price_czk" numeric DEFAULT 26400 NOT NULL,
  	"source_setup_fee_czk" numeric DEFAULT 500 NOT NULL,
  	"max_input_tokens_per_run" numeric DEFAULT 60000 NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "municipalities" ADD COLUMN "billing_status" "enum_municipalities_billing_status" DEFAULT 'active';
  ALTER TABLE "municipalities" ADD COLUMN "billing_note" varchar;
  ALTER TABLE "municipalities" ADD COLUMN "licence_period_start" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "licence_period_end" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "licence_tier" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "licence_custom_yearly_czk" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "implementation_fee_czk" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "sms_package" "enum_municipalities_sms_package" DEFAULT 's';
  ALTER TABLE "municipalities" ADD COLUMN "sms_quota_override" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "sms_overage_allowed" boolean DEFAULT false;
  ALTER TABLE "municipalities" ADD COLUMN "sms_alert_state" varchar;
  ALTER TABLE "municipalities" ADD COLUMN "scraping_package" "enum_municipalities_scraping_package" DEFAULT 's';
  ALTER TABLE "municipalities" ADD COLUMN "scraping_max_sources_override" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "scraping_slot_day" numeric DEFAULT 1;
  ALTER TABLE "municipalities" ADD COLUMN "scraping_slot_hour" numeric DEFAULT 2;
  ALTER TABLE "municipalities" ADD COLUMN "scraping_frequency" "enum_municipalities_scraping_frequency" DEFAULT 'weekly';
  ALTER TABLE "municipalities" ADD COLUMN "scraping_max_input_tokens_override" numeric;
  ALTER TABLE "profiles" ADD COLUMN "notify_sms" boolean DEFAULT false;
  ALTER TABLE "import_runs" ADD COLUMN "review_status" "enum_import_runs_review_status";
  ALTER TABLE "import_runs" ADD COLUMN "review_note" varchar;
  ALTER TABLE "import_runs" ADD COLUMN "reviewed_by_id" integer;
  ALTER TABLE "import_runs" ADD COLUMN "reviewed_at" timestamp(3) with time zone;
  ALTER TABLE "sms_messages" ADD COLUMN "parts" numeric DEFAULT 1;
  ALTER TABLE "sms_messages" ADD COLUMN "overage" boolean DEFAULT false;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "active_user_snapshots_id" integer;
  ALTER TABLE "active_user_snapshots" ADD CONSTRAINT "active_user_snapshots_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "active_user_snapshots" ADD CONSTRAINT "active_user_snapshots_taken_by_id_users_id_fk" FOREIGN KEY ("taken_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "billing_settings_licence_tiers" ADD CONSTRAINT "billing_settings_licence_tiers_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."billing_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "active_user_snapshots_municipality_idx" ON "active_user_snapshots" USING btree ("municipality_id");
  CREATE INDEX "active_user_snapshots_month_idx" ON "active_user_snapshots" USING btree ("month");
  CREATE INDEX "active_user_snapshots_taken_by_idx" ON "active_user_snapshots" USING btree ("taken_by_id");
  CREATE INDEX "active_user_snapshots_updated_at_idx" ON "active_user_snapshots" USING btree ("updated_at");
  CREATE INDEX "active_user_snapshots_created_at_idx" ON "active_user_snapshots" USING btree ("created_at");
  CREATE INDEX "billing_settings_licence_tiers_order_idx" ON "billing_settings_licence_tiers" USING btree ("_order");
  CREATE INDEX "billing_settings_licence_tiers_parent_id_idx" ON "billing_settings_licence_tiers" USING btree ("_parent_id");
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_active_user_snapshots_fk" FOREIGN KEY ("active_user_snapshots_id") REFERENCES "public"."active_user_snapshots"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "import_runs_reviewed_by_idx" ON "import_runs" USING btree ("reviewed_by_id");
  CREATE INDEX "payload_locked_documents_rels_active_user_snapshots_id_idx" ON "payload_locked_documents_rels" USING btree ("active_user_snapshots_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "active_user_snapshots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "billing_settings_licence_tiers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "billing_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "active_user_snapshots" CASCADE;
  DROP TABLE "billing_settings_licence_tiers" CASCADE;
  DROP TABLE "billing_settings" CASCADE;
  ALTER TABLE "import_runs" DROP CONSTRAINT "import_runs_reviewed_by_id_users_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_active_user_snapshots_fk";
  
  DROP INDEX "import_runs_reviewed_by_idx";
  DROP INDEX "payload_locked_documents_rels_active_user_snapshots_id_idx";
  ALTER TABLE "municipalities" DROP COLUMN "billing_status";
  ALTER TABLE "municipalities" DROP COLUMN "billing_note";
  ALTER TABLE "municipalities" DROP COLUMN "licence_period_start";
  ALTER TABLE "municipalities" DROP COLUMN "licence_period_end";
  ALTER TABLE "municipalities" DROP COLUMN "licence_tier";
  ALTER TABLE "municipalities" DROP COLUMN "licence_custom_yearly_czk";
  ALTER TABLE "municipalities" DROP COLUMN "implementation_fee_czk";
  ALTER TABLE "municipalities" DROP COLUMN "sms_package";
  ALTER TABLE "municipalities" DROP COLUMN "sms_quota_override";
  ALTER TABLE "municipalities" DROP COLUMN "sms_overage_allowed";
  ALTER TABLE "municipalities" DROP COLUMN "sms_alert_state";
  ALTER TABLE "municipalities" DROP COLUMN "scraping_package";
  ALTER TABLE "municipalities" DROP COLUMN "scraping_max_sources_override";
  ALTER TABLE "municipalities" DROP COLUMN "scraping_slot_day";
  ALTER TABLE "municipalities" DROP COLUMN "scraping_slot_hour";
  ALTER TABLE "municipalities" DROP COLUMN "scraping_frequency";
  ALTER TABLE "municipalities" DROP COLUMN "scraping_max_input_tokens_override";
  ALTER TABLE "profiles" DROP COLUMN "notify_sms";
  ALTER TABLE "import_runs" DROP COLUMN "review_status";
  ALTER TABLE "import_runs" DROP COLUMN "review_note";
  ALTER TABLE "import_runs" DROP COLUMN "reviewed_by_id";
  ALTER TABLE "import_runs" DROP COLUMN "reviewed_at";
  ALTER TABLE "sms_messages" DROP COLUMN "parts";
  ALTER TABLE "sms_messages" DROP COLUMN "overage";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "active_user_snapshots_id";
  DROP TYPE "public"."enum_municipalities_billing_status";
  DROP TYPE "public"."enum_municipalities_sms_package";
  DROP TYPE "public"."enum_municipalities_scraping_package";
  DROP TYPE "public"."enum_municipalities_scraping_frequency";
  DROP TYPE "public"."enum_import_runs_review_status";`)
}
