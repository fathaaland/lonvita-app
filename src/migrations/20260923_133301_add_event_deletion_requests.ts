import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_event_deletion_requests_status" AS ENUM('pending', 'approved', 'rejected', 'expired');
  CREATE TABLE "event_deletion_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer,
  	"event_title" varchar NOT NULL,
  	"municipality_id" integer,
  	"requested_by_id" integer NOT NULL,
  	"status" "enum_event_deletion_requests_status" DEFAULT 'pending' NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"decided_by_id" integer,
  	"decided_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_deletion_requests_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_deletion_requests_id" integer;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_deletion_requests_rels" ADD CONSTRAINT "event_deletion_requests_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."event_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "event_deletion_requests_rels" ADD CONSTRAINT "event_deletion_requests_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "event_deletion_requests_event_idx" ON "event_deletion_requests" USING btree ("event_id");
  CREATE INDEX "event_deletion_requests_municipality_idx" ON "event_deletion_requests" USING btree ("municipality_id");
  CREATE INDEX "event_deletion_requests_requested_by_idx" ON "event_deletion_requests" USING btree ("requested_by_id");
  CREATE INDEX "event_deletion_requests_decided_by_idx" ON "event_deletion_requests" USING btree ("decided_by_id");
  CREATE INDEX "event_deletion_requests_updated_at_idx" ON "event_deletion_requests" USING btree ("updated_at");
  CREATE INDEX "event_deletion_requests_created_at_idx" ON "event_deletion_requests" USING btree ("created_at");
  CREATE INDEX "event_deletion_requests_rels_order_idx" ON "event_deletion_requests_rels" USING btree ("order");
  CREATE INDEX "event_deletion_requests_rels_parent_idx" ON "event_deletion_requests_rels" USING btree ("parent_id");
  CREATE INDEX "event_deletion_requests_rels_path_idx" ON "event_deletion_requests_rels" USING btree ("path");
  CREATE INDEX "event_deletion_requests_rels_users_id_idx" ON "event_deletion_requests_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_deletion_requests_fk" FOREIGN KEY ("event_deletion_requests_id") REFERENCES "public"."event_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_event_deletion_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("event_deletion_requests_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_deletion_requests_fk";
  DROP INDEX "payload_locked_documents_rels_event_deletion_requests_id_idx";
  ALTER TABLE "event_deletion_requests" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_deletion_requests_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "event_deletion_requests" CASCADE;
  DROP TABLE "event_deletion_requests_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_deletion_requests_id";
  DROP TYPE "public"."enum_event_deletion_requests_status";`)
}
