import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_event_sources_format" AS ENUM('ical', 'jsonld', 'html', 'feed', 'pdf', 'image');
  CREATE TYPE "public"."enum_event_import_candidates_origin" AS ENUM('source', 'text', 'file');
  CREATE TYPE "public"."enum_event_import_candidates_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TABLE "event_sources" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"url" varchar NOT NULL,
  	"label" varchar,
  	"enabled" boolean DEFAULT true,
  	"created_by_id" integer,
  	"format" "enum_event_sources_format",
  	"last_run_at" timestamp(3) with time zone,
  	"last_success_at" timestamp(3) with time zone,
  	"last_error" varchar,
  	"last_found_count" numeric,
  	"consecutive_failures" numeric DEFAULT 0,
  	"last_content_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_import_candidates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"source_id" integer,
  	"origin" "enum_event_import_candidates_origin" NOT NULL,
  	"origin_label" varchar,
  	"requested_by_id" integer,
  	"external_key" varchar NOT NULL,
  	"status" "enum_event_import_candidates_status" DEFAULT 'pending' NOT NULL,
  	"title" varchar NOT NULL,
  	"description" varchar,
  	"starts_at" timestamp(3) with time zone NOT NULL,
  	"time_known" boolean DEFAULT true,
  	"ends_at" timestamp(3) with time zone,
  	"location_text" varchar,
  	"lat" numeric,
  	"lng" numeric,
  	"detail_url" varchar,
  	"is_paid" boolean,
  	"price_czk" numeric,
  	"warnings" jsonb,
  	"duplicate_of_id" integer,
  	"event_id" integer,
  	"decided_by_id" integer,
  	"decided_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_import_candidates_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"event_categories_id" integer
  );
  
  ALTER TABLE "events" ADD COLUMN "imported_from" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_sources_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_import_candidates_id" integer;
  ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_source_id_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."event_sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_duplicate_of_id_events_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates_rels" ADD CONSTRAINT "event_import_candidates_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."event_import_candidates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "event_import_candidates_rels" ADD CONSTRAINT "event_import_candidates_rels_event_categories_fk" FOREIGN KEY ("event_categories_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "event_sources_municipality_idx" ON "event_sources" USING btree ("municipality_id");
  CREATE INDEX "event_sources_created_by_idx" ON "event_sources" USING btree ("created_by_id");
  CREATE INDEX "event_sources_updated_at_idx" ON "event_sources" USING btree ("updated_at");
  CREATE INDEX "event_sources_created_at_idx" ON "event_sources" USING btree ("created_at");
  CREATE INDEX "event_import_candidates_municipality_idx" ON "event_import_candidates" USING btree ("municipality_id");
  CREATE INDEX "event_import_candidates_source_idx" ON "event_import_candidates" USING btree ("source_id");
  CREATE INDEX "event_import_candidates_requested_by_idx" ON "event_import_candidates" USING btree ("requested_by_id");
  CREATE INDEX "event_import_candidates_external_key_idx" ON "event_import_candidates" USING btree ("external_key");
  CREATE INDEX "event_import_candidates_status_idx" ON "event_import_candidates" USING btree ("status");
  CREATE INDEX "event_import_candidates_starts_at_idx" ON "event_import_candidates" USING btree ("starts_at");
  CREATE INDEX "event_import_candidates_duplicate_of_idx" ON "event_import_candidates" USING btree ("duplicate_of_id");
  CREATE INDEX "event_import_candidates_event_idx" ON "event_import_candidates" USING btree ("event_id");
  CREATE INDEX "event_import_candidates_decided_by_idx" ON "event_import_candidates" USING btree ("decided_by_id");
  CREATE INDEX "event_import_candidates_updated_at_idx" ON "event_import_candidates" USING btree ("updated_at");
  CREATE INDEX "event_import_candidates_created_at_idx" ON "event_import_candidates" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_import_candidates_municipality_key_idx" ON "event_import_candidates" USING btree ("municipality_id","external_key");
  CREATE INDEX "event_import_candidates_rels_order_idx" ON "event_import_candidates_rels" USING btree ("order");
  CREATE INDEX "event_import_candidates_rels_parent_idx" ON "event_import_candidates_rels" USING btree ("parent_id");
  CREATE INDEX "event_import_candidates_rels_path_idx" ON "event_import_candidates_rels" USING btree ("path");
  CREATE INDEX "event_import_candidates_rels_event_categories_id_idx" ON "event_import_candidates_rels" USING btree ("event_categories_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_sources_fk" FOREIGN KEY ("event_sources_id") REFERENCES "public"."event_sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_import_candidates_fk" FOREIGN KEY ("event_import_candidates_id") REFERENCES "public"."event_import_candidates"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_event_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("event_sources_id");
  CREATE INDEX "payload_locked_documents_rels_event_import_candidates_id_idx" ON "payload_locked_documents_rels" USING btree ("event_import_candidates_id");`)
}

// The DROP TABLE … CASCADE below already takes the payload_locked_documents_rels foreign keys along —
// IF EXISTS keeps the down from failing on them.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_import_candidates" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_import_candidates_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "event_sources" CASCADE;
  DROP TABLE "event_import_candidates" CASCADE;
  DROP TABLE "event_import_candidates_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_sources_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_import_candidates_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_event_sources_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_event_import_candidates_id_idx";
  ALTER TABLE "events" DROP COLUMN "imported_from";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_sources_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_import_candidates_id";
  DROP TYPE "public"."enum_event_sources_format";
  DROP TYPE "public"."enum_event_import_candidates_origin";
  DROP TYPE "public"."enum_event_import_candidates_status";`)
}
