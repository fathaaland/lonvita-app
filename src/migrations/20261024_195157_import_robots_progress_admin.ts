import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "import_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"ai_enabled" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "municipalities" ADD COLUMN "import_ai_budget_usd" numeric;
  ALTER TABLE "event_sources" ADD COLUMN "ignore_robots" boolean DEFAULT false;
  ALTER TABLE "event_sources" ADD COLUMN "ignore_robots_at" timestamp(3) with time zone;
  ALTER TABLE "event_sources" ADD COLUMN "ignore_robots_by_id" integer;
  ALTER TABLE "event_sources" ADD COLUMN "queued_at" timestamp(3) with time zone;
  ALTER TABLE "event_sources" ADD COLUMN "running_since" timestamp(3) with time zone;
  ALTER TABLE "event_sources" ADD COLUMN "last_error_code" varchar;
  ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_ignore_robots_by_id_users_id_fk" FOREIGN KEY ("ignore_robots_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "event_sources_ignore_robots_by_idx" ON "event_sources" USING btree ("ignore_robots_by_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "import_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "import_settings" CASCADE;
  ALTER TABLE "event_sources" DROP CONSTRAINT "event_sources_ignore_robots_by_id_users_id_fk";
  
  DROP INDEX "event_sources_ignore_robots_by_idx";
  ALTER TABLE "municipalities" DROP COLUMN "import_ai_budget_usd";
  ALTER TABLE "event_sources" DROP COLUMN "ignore_robots";
  ALTER TABLE "event_sources" DROP COLUMN "ignore_robots_at";
  ALTER TABLE "event_sources" DROP COLUMN "ignore_robots_by_id";
  ALTER TABLE "event_sources" DROP COLUMN "queued_at";
  ALTER TABLE "event_sources" DROP COLUMN "running_since";
  ALTER TABLE "event_sources" DROP COLUMN "last_error_code";`)
}
