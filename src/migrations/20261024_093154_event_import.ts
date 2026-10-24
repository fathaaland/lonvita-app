import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_event_sources_format" AS ENUM('ical', 'jsonld', 'html', 'feed', 'pdf', 'image');
  CREATE TYPE "public"."enum_event_import_candidates_origin" AS ENUM('source', 'text', 'file');
  CREATE TYPE "public"."enum_event_import_candidates_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TYPE "public"."enum_import_runs_trigger" AS ENUM('daily', 'weekly', 'manual', 'new_source', 'text', 'file');
  CREATE TYPE "public"."enum_import_runs_status" AS ENUM('running', 'success', 'unchanged', 'failed', 'skipped');
  CREATE TYPE "public"."enum_usage_events_operation_type" AS ENUM('event_import', 'event_import_details');
  CREATE TYPE "public"."enum_usage_events_source" AS ENUM('api', 'worker');
  CREATE TYPE "public"."enum_usage_events_usage_kind" AS ENUM('tokens', 'search_units');
  CREATE TYPE "public"."enum_usage_events_status" AS ENUM('success', 'error', 'aborted');
  CREATE TABLE "event_sources" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"organization_id" integer,
  	"url" varchar NOT NULL,
  	"label" varchar,
  	"enabled" boolean DEFAULT true,
  	"created_by_id" integer,
  	"owner_consent_at" timestamp(3) with time zone,
  	"format" "enum_event_sources_format",
  	"last_run_at" timestamp(3) with time zone,
  	"last_success_at" timestamp(3) with time zone,
  	"last_error" varchar,
  	"last_found_count" numeric,
  	"consecutive_failures" numeric DEFAULT 0,
  	"last_content_hash" varchar,
  	"etag" varchar,
  	"last_modified" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_import_candidates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"organization_id" integer,
  	"source_id" integer,
  	"origin" "enum_event_import_candidates_origin" NOT NULL,
  	"origin_label" varchar,
  	"requested_by_id" integer,
  	"external_key" varchar NOT NULL,
  	"source_ref" varchar,
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
  	"sync_notices" jsonb,
  	"sync_needs_review" boolean DEFAULT false,
  	"noticed_at" timestamp(3) with time zone,
  	"last_synced_at" timestamp(3) with time zone,
  	"last_seen_at" timestamp(3) with time zone,
  	"missing_count" numeric DEFAULT 0,
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
  
  CREATE TABLE "import_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"organization_id" integer,
  	"source_id" integer,
  	"trigger" "enum_import_runs_trigger" NOT NULL,
  	"requested_by_id" integer,
  	"status" "enum_import_runs_status" DEFAULT 'running' NOT NULL,
  	"started_at" timestamp(3) with time zone NOT NULL,
  	"finished_at" timestamp(3) with time zone,
  	"format" varchar,
  	"error" varchar,
  	"error_code" varchar,
  	"found" numeric DEFAULT 0,
  	"created" numeric DEFAULT 0,
  	"updated" numeric DEFAULT 0,
  	"synced" numeric DEFAULT 0,
  	"needs_review" numeric DEFAULT 0,
  	"ai_calls" numeric DEFAULT 0,
  	"input_tokens" numeric DEFAULT 0,
  	"output_tokens" numeric DEFAULT 0,
  	"cost_usd" numeric DEFAULT 0,
  	"job_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "usage_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer,
  	"user_id" integer,
  	"organization_id" integer,
  	"event_source_id" integer,
  	"import_run_id" integer,
  	"provider" varchar NOT NULL,
  	"model" varchar NOT NULL,
  	"operation_type" "enum_usage_events_operation_type" NOT NULL,
  	"source" "enum_usage_events_source" NOT NULL,
  	"usage_kind" "enum_usage_events_usage_kind" NOT NULL,
  	"input_tokens" numeric,
  	"output_tokens" numeric,
  	"cached_input_tokens" numeric,
  	"reasoning_tokens" numeric,
  	"total_tokens" numeric,
  	"search_units" numeric,
  	"input_price_per_m_tok" numeric,
  	"output_price_per_m_tok" numeric,
  	"cost_usd" numeric,
  	"status" "enum_usage_events_status" NOT NULL,
  	"request_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "events" ADD COLUMN "imported_from" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_sources_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_import_candidates_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "import_runs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "usage_events_id" integer;
  ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_source_id_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."event_sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_duplicate_of_id_events_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates" ADD CONSTRAINT "event_import_candidates_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_import_candidates_rels" ADD CONSTRAINT "event_import_candidates_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."event_import_candidates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "event_import_candidates_rels" ADD CONSTRAINT "event_import_candidates_rels_event_categories_fk" FOREIGN KEY ("event_categories_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_source_id_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."event_sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_event_source_id_event_sources_id_fk" FOREIGN KEY ("event_source_id") REFERENCES "public"."event_sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "event_sources_municipality_idx" ON "event_sources" USING btree ("municipality_id");
  CREATE INDEX "event_sources_organization_idx" ON "event_sources" USING btree ("organization_id");
  CREATE INDEX "event_sources_created_by_idx" ON "event_sources" USING btree ("created_by_id");
  CREATE INDEX "event_sources_updated_at_idx" ON "event_sources" USING btree ("updated_at");
  CREATE INDEX "event_sources_created_at_idx" ON "event_sources" USING btree ("created_at");
  CREATE INDEX "event_import_candidates_municipality_idx" ON "event_import_candidates" USING btree ("municipality_id");
  CREATE INDEX "event_import_candidates_organization_idx" ON "event_import_candidates" USING btree ("organization_id");
  CREATE INDEX "event_import_candidates_source_idx" ON "event_import_candidates" USING btree ("source_id");
  CREATE INDEX "event_import_candidates_requested_by_idx" ON "event_import_candidates" USING btree ("requested_by_id");
  CREATE INDEX "event_import_candidates_external_key_idx" ON "event_import_candidates" USING btree ("external_key");
  CREATE INDEX "event_import_candidates_source_ref_idx" ON "event_import_candidates" USING btree ("source_ref");
  CREATE INDEX "event_import_candidates_status_idx" ON "event_import_candidates" USING btree ("status");
  CREATE INDEX "event_import_candidates_starts_at_idx" ON "event_import_candidates" USING btree ("starts_at");
  CREATE INDEX "event_import_candidates_duplicate_of_idx" ON "event_import_candidates" USING btree ("duplicate_of_id");
  CREATE INDEX "event_import_candidates_event_idx" ON "event_import_candidates" USING btree ("event_id");
  CREATE INDEX "event_import_candidates_decided_by_idx" ON "event_import_candidates" USING btree ("decided_by_id");
  CREATE INDEX "event_import_candidates_sync_needs_review_idx" ON "event_import_candidates" USING btree ("sync_needs_review");
  CREATE INDEX "event_import_candidates_updated_at_idx" ON "event_import_candidates" USING btree ("updated_at");
  CREATE INDEX "event_import_candidates_created_at_idx" ON "event_import_candidates" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_import_candidates_municipality_key_idx" ON "event_import_candidates" USING btree ("municipality_id","external_key");
  CREATE INDEX "event_import_candidates_rels_order_idx" ON "event_import_candidates_rels" USING btree ("order");
  CREATE INDEX "event_import_candidates_rels_parent_idx" ON "event_import_candidates_rels" USING btree ("parent_id");
  CREATE INDEX "event_import_candidates_rels_path_idx" ON "event_import_candidates_rels" USING btree ("path");
  CREATE INDEX "event_import_candidates_rels_event_categories_id_idx" ON "event_import_candidates_rels" USING btree ("event_categories_id");
  CREATE INDEX "import_runs_municipality_idx" ON "import_runs" USING btree ("municipality_id");
  CREATE INDEX "import_runs_organization_idx" ON "import_runs" USING btree ("organization_id");
  CREATE INDEX "import_runs_source_idx" ON "import_runs" USING btree ("source_id");
  CREATE INDEX "import_runs_requested_by_idx" ON "import_runs" USING btree ("requested_by_id");
  CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");
  CREATE INDEX "import_runs_started_at_idx" ON "import_runs" USING btree ("started_at");
  CREATE INDEX "import_runs_updated_at_idx" ON "import_runs" USING btree ("updated_at");
  CREATE INDEX "import_runs_created_at_idx" ON "import_runs" USING btree ("created_at");
  CREATE INDEX "usage_events_municipality_idx" ON "usage_events" USING btree ("municipality_id");
  CREATE INDEX "usage_events_user_idx" ON "usage_events" USING btree ("user_id");
  CREATE INDEX "usage_events_organization_idx" ON "usage_events" USING btree ("organization_id");
  CREATE INDEX "usage_events_event_source_idx" ON "usage_events" USING btree ("event_source_id");
  CREATE INDEX "usage_events_import_run_idx" ON "usage_events" USING btree ("import_run_id");
  CREATE INDEX "usage_events_request_id_idx" ON "usage_events" USING btree ("request_id");
  CREATE INDEX "usage_events_updated_at_idx" ON "usage_events" USING btree ("updated_at");
  CREATE INDEX "usage_events_created_at_idx" ON "usage_events" USING btree ("created_at");
  CREATE INDEX "usage_events_municipality_created_at_idx" ON "usage_events" USING btree ("municipality_id","created_at");
  CREATE INDEX "usage_events_municipality_user_created_at_idx" ON "usage_events" USING btree ("municipality_id","user_id","created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_sources_fk" FOREIGN KEY ("event_sources_id") REFERENCES "public"."event_sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_import_candidates_fk" FOREIGN KEY ("event_import_candidates_id") REFERENCES "public"."event_import_candidates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_import_runs_fk" FOREIGN KEY ("import_runs_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_usage_events_fk" FOREIGN KEY ("usage_events_id") REFERENCES "public"."usage_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_event_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("event_sources_id");
  CREATE INDEX "payload_locked_documents_rels_event_import_candidates_id_idx" ON "payload_locked_documents_rels" USING btree ("event_import_candidates_id");
  CREATE INDEX "payload_locked_documents_rels_import_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("import_runs_id");
  CREATE INDEX "payload_locked_documents_rels_usage_events_id_idx" ON "payload_locked_documents_rels" USING btree ("usage_events_id");`)
}

// DROP TABLE … CASCADE below already takes the payload_locked_documents_rels foreign keys along —
// IF EXISTS keeps down from failing on them.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_import_candidates" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_import_candidates_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "import_runs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "usage_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "event_sources" CASCADE;
  DROP TABLE "event_import_candidates" CASCADE;
  DROP TABLE "event_import_candidates_rels" CASCADE;
  DROP TABLE "import_runs" CASCADE;
  DROP TABLE "usage_events" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_sources_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_import_candidates_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_import_runs_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_usage_events_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_event_sources_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_event_import_candidates_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_import_runs_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_usage_events_id_idx";
  ALTER TABLE "events" DROP COLUMN "imported_from";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_sources_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_import_candidates_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "import_runs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "usage_events_id";
  DROP TYPE "public"."enum_event_sources_format";
  DROP TYPE "public"."enum_event_import_candidates_origin";
  DROP TYPE "public"."enum_event_import_candidates_status";
  DROP TYPE "public"."enum_import_runs_trigger";
  DROP TYPE "public"."enum_import_runs_status";
  DROP TYPE "public"."enum_usage_events_operation_type";
  DROP TYPE "public"."enum_usage_events_source";
  DROP TYPE "public"."enum_usage_events_usage_kind";
  DROP TYPE "public"."enum_usage_events_status";`)
}
