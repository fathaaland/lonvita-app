import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "outbox" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"job_type" varchar NOT NULL,
  	"job_id" varchar NOT NULL,
  	"job" jsonb NOT NULL,
  	"run_at" timestamp(3) with time zone,
  	"dispatched_at" timestamp(3) with time zone,
  	"attempts" numeric DEFAULT 0,
  	"last_error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "media" ADD COLUMN "sizes_display_url" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_display_width" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_display_height" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_display_mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_display_filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_display_filename" varchar;
  ALTER TABLE "notifications" ADD COLUMN "dedup_key" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "outbox_id" integer;
  CREATE INDEX "outbox_dispatched_at_idx" ON "outbox" USING btree ("dispatched_at");
  CREATE INDEX "outbox_updated_at_idx" ON "outbox" USING btree ("updated_at");
  CREATE INDEX "outbox_created_at_idx" ON "outbox" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outbox_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "media_sizes_display_sizes_display_filename_idx" ON "media" USING btree ("sizes_display_filename");
  CREATE UNIQUE INDEX "profiles_phone_idx" ON "profiles" USING btree ("phone") WHERE "profiles"."phone" IS NOT NULL;
  CREATE UNIQUE INDEX "user_roles_user_role_municipality_idx" ON "user_roles" USING btree ("user_id","role","municipality_id");
  CREATE UNIQUE INDEX "notifications_dedup_key_idx" ON "notifications" USING btree ("dedup_key");
  CREATE UNIQUE INDEX "organizations_owner_municipality_idx" ON "organizations" USING btree ("owner_id","municipality_id") WHERE "organizations"."owner_id" IS NOT NULL;
  CREATE UNIQUE INDEX "organizations_obec_own_idx" ON "organizations" USING btree ("municipality_id") WHERE "organizations"."type" = 'municipality';
  CREATE UNIQUE INDEX "active_user_snapshots_municipality_month_idx" ON "active_user_snapshots" USING btree ("municipality_id","month");
  CREATE INDEX "payload_locked_documents_rels_outbox_id_idx" ON "payload_locked_documents_rels" USING btree ("outbox_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "outbox" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "outbox" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_outbox_fk";
  
  DROP INDEX "media_sizes_display_sizes_display_filename_idx";
  DROP INDEX "profiles_phone_idx";
  DROP INDEX "user_roles_user_role_municipality_idx";
  DROP INDEX "notifications_dedup_key_idx";
  DROP INDEX "organizations_owner_municipality_idx";
  DROP INDEX "organizations_obec_own_idx";
  DROP INDEX "active_user_snapshots_municipality_month_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_outbox_id_idx";
  ALTER TABLE "media" DROP COLUMN "sizes_display_url";
  ALTER TABLE "media" DROP COLUMN "sizes_display_width";
  ALTER TABLE "media" DROP COLUMN "sizes_display_height";
  ALTER TABLE "media" DROP COLUMN "sizes_display_mime_type";
  ALTER TABLE "media" DROP COLUMN "sizes_display_filesize";
  ALTER TABLE "media" DROP COLUMN "sizes_display_filename";
  ALTER TABLE "notifications" DROP COLUMN "dedup_key";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "outbox_id";`)
}
