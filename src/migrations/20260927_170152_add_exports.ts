import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_exports_kind" AS ENUM('community-report', 'organization-report', 'municipality-events');
  CREATE TYPE "public"."enum_exports_format" AS ENUM('docx', 'pdf', 'csv');
  CREATE TYPE "public"."enum_exports_status" AS ENUM('queued', 'processing', 'done', 'failed');
  CREATE TABLE "exports" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"owner_id" integer NOT NULL,
  	"kind" "enum_exports_kind" NOT NULL,
  	"format" "enum_exports_format" NOT NULL,
  	"params" jsonb NOT NULL,
  	"status" "enum_exports_status" DEFAULT 'queued' NOT NULL,
  	"file_key" varchar,
  	"file_name" varchar,
  	"error" varchar,
  	"downloaded_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "exports_id" integer;
  ALTER TABLE "exports" ADD CONSTRAINT "exports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "exports_owner_idx" ON "exports" USING btree ("owner_id");
  CREATE INDEX "exports_status_idx" ON "exports" USING btree ("status");
  CREATE INDEX "exports_expires_at_idx" ON "exports" USING btree ("expires_at");
  CREATE INDEX "exports_updated_at_idx" ON "exports" USING btree ("updated_at");
  CREATE INDEX "exports_created_at_idx" ON "exports" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_exports_fk" FOREIGN KEY ("exports_id") REFERENCES "public"."exports"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_exports_id_idx" ON "payload_locked_documents_rels" USING btree ("exports_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "exports" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "exports" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_exports_fk";
  
  DROP INDEX "payload_locked_documents_rels_exports_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "exports_id";
  DROP TYPE "public"."enum_exports_kind";
  DROP TYPE "public"."enum_exports_format";
  DROP TYPE "public"."enum_exports_status";`)
}
