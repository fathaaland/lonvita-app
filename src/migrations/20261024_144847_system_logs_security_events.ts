import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_system_logs_level" AS ENUM('info', 'warn', 'error', 'fatal');
  CREATE TYPE "public"."enum_security_events_outcome" AS ENUM('success', 'failure');
  CREATE TABLE "system_logs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"level" "enum_system_logs_level" NOT NULL,
  	"event" varchar,
  	"message" varchar NOT NULL,
  	"service" varchar NOT NULL,
  	"environment" varchar,
  	"correlation_id" varchar,
  	"user_id" numeric,
  	"municipality_id" numeric,
  	"error_name" varchar,
  	"error_message" varchar,
  	"error_stack" varchar,
  	"context" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "security_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event" varchar NOT NULL,
  	"outcome" "enum_security_events_outcome" NOT NULL,
  	"message" varchar NOT NULL,
  	"user_id" numeric,
  	"user_email" varchar,
  	"ip" varchar,
  	"user_agent" varchar,
  	"service" varchar,
  	"correlation_id" varchar,
  	"context" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "system_logs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "security_events_id" integer;
  CREATE INDEX "system_logs_level_idx" ON "system_logs" USING btree ("level");
  CREATE INDEX "system_logs_event_idx" ON "system_logs" USING btree ("event");
  CREATE INDEX "system_logs_service_idx" ON "system_logs" USING btree ("service");
  CREATE INDEX "system_logs_correlation_id_idx" ON "system_logs" USING btree ("correlation_id");
  CREATE INDEX "system_logs_user_id_idx" ON "system_logs" USING btree ("user_id");
  CREATE INDEX "system_logs_municipality_id_idx" ON "system_logs" USING btree ("municipality_id");
  CREATE INDEX "system_logs_updated_at_idx" ON "system_logs" USING btree ("updated_at");
  CREATE INDEX "system_logs_created_at_idx" ON "system_logs" USING btree ("created_at");
  CREATE INDEX "security_events_event_idx" ON "security_events" USING btree ("event");
  CREATE INDEX "security_events_outcome_idx" ON "security_events" USING btree ("outcome");
  CREATE INDEX "security_events_user_id_idx" ON "security_events" USING btree ("user_id");
  CREATE INDEX "security_events_user_email_idx" ON "security_events" USING btree ("user_email");
  CREATE INDEX "security_events_ip_idx" ON "security_events" USING btree ("ip");
  CREATE INDEX "security_events_correlation_id_idx" ON "security_events" USING btree ("correlation_id");
  CREATE INDEX "security_events_updated_at_idx" ON "security_events" USING btree ("updated_at");
  CREATE INDEX "security_events_created_at_idx" ON "security_events" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_system_logs_fk" FOREIGN KEY ("system_logs_id") REFERENCES "public"."system_logs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_security_events_fk" FOREIGN KEY ("security_events_id") REFERENCES "public"."security_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_system_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("system_logs_id");
  CREATE INDEX "payload_locked_documents_rels_security_events_id_idx" ON "payload_locked_documents_rels" USING btree ("security_events_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "system_logs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "security_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "system_logs" CASCADE;
  DROP TABLE "security_events" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_system_logs_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_security_events_fk";
  
  DROP INDEX "payload_locked_documents_rels_system_logs_id_idx";
  DROP INDEX "payload_locked_documents_rels_security_events_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "system_logs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "security_events_id";
  DROP TYPE "public"."enum_system_logs_level";
  DROP TYPE "public"."enum_security_events_outcome";`)
}
