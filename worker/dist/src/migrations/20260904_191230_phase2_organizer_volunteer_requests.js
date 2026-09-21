import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   CREATE TYPE "public"."enum_organizer_requests_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TYPE "public"."enum_volunteer_flag_requests_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TABLE "organizer_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"status" "enum_organizer_requests_status" DEFAULT 'pending' NOT NULL,
  	"reviewed_by_id" integer,
  	"reviewed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "volunteer_flag_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"requested_by_id" integer NOT NULL,
  	"status" "enum_volunteer_flag_requests_status" DEFAULT 'pending' NOT NULL,
  	"reviewed_by_id" integer,
  	"reviewed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "organizer_requests_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "volunteer_flag_requests_id" integer;
  ALTER TABLE "organizer_requests" ADD CONSTRAINT "organizer_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "organizer_requests" ADD CONSTRAINT "organizer_requests_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "organizer_requests" ADD CONSTRAINT "organizer_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_flag_requests" ADD CONSTRAINT "volunteer_flag_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_flag_requests" ADD CONSTRAINT "volunteer_flag_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_flag_requests" ADD CONSTRAINT "volunteer_flag_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "organizer_requests_user_idx" ON "organizer_requests" USING btree ("user_id");
  CREATE INDEX "organizer_requests_municipality_idx" ON "organizer_requests" USING btree ("municipality_id");
  CREATE INDEX "organizer_requests_reviewed_by_idx" ON "organizer_requests" USING btree ("reviewed_by_id");
  CREATE INDEX "organizer_requests_updated_at_idx" ON "organizer_requests" USING btree ("updated_at");
  CREATE INDEX "organizer_requests_created_at_idx" ON "organizer_requests" USING btree ("created_at");
  CREATE INDEX "volunteer_flag_requests_event_idx" ON "volunteer_flag_requests" USING btree ("event_id");
  CREATE INDEX "volunteer_flag_requests_requested_by_idx" ON "volunteer_flag_requests" USING btree ("requested_by_id");
  CREATE INDEX "volunteer_flag_requests_reviewed_by_idx" ON "volunteer_flag_requests" USING btree ("reviewed_by_id");
  CREATE INDEX "volunteer_flag_requests_updated_at_idx" ON "volunteer_flag_requests" USING btree ("updated_at");
  CREATE INDEX "volunteer_flag_requests_created_at_idx" ON "volunteer_flag_requests" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organizer_requests_fk" FOREIGN KEY ("organizer_requests_id") REFERENCES "public"."organizer_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_volunteer_flag_requests_fk" FOREIGN KEY ("volunteer_flag_requests_id") REFERENCES "public"."volunteer_flag_requests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_organizer_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("organizer_requests_id");
  CREATE INDEX "payload_locked_documents_rels_volunteer_flag_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("volunteer_flag_requests_id");`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "organizer_requests" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "volunteer_flag_requests" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "organizer_requests" CASCADE;
  DROP TABLE "volunteer_flag_requests" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_organizer_requests_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_volunteer_flag_requests_fk";
  
  DROP INDEX "payload_locked_documents_rels_organizer_requests_id_idx";
  DROP INDEX "payload_locked_documents_rels_volunteer_flag_requests_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "organizer_requests_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "volunteer_flag_requests_id";
  DROP TYPE "public"."enum_organizer_requests_status";
  DROP TYPE "public"."enum_volunteer_flag_requests_status";`);
}
