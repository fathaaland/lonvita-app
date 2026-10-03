import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_review_complaints_review_type" AS ENUM('event-feedback', 'volunteer-rating');
  CREATE TYPE "public"."enum_review_complaints_status" AS ENUM('pending', 'upheld', 'rejected');
  CREATE TABLE "review_complaints" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"review_type" "enum_review_complaints_review_type" NOT NULL,
  	"event_feedback_id" integer,
  	"volunteer_rating_id" integer,
  	"event_id" integer,
  	"municipality_id" integer NOT NULL,
  	"complainant_id" integer NOT NULL,
  	"reason" varchar NOT NULL,
  	"status" "enum_review_complaints_status" DEFAULT 'pending' NOT NULL,
  	"decided_by_id" integer,
  	"decided_at" timestamp(3) with time zone,
  	"decision_note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "volunteer_ratings" ADD COLUMN "deleted_at" timestamp(3) with time zone;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "review_complaints_id" integer;
  ALTER TABLE "review_complaints" ADD CONSTRAINT "review_complaints_event_feedback_id_event_feedback_id_fk" FOREIGN KEY ("event_feedback_id") REFERENCES "public"."event_feedback"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_complaints" ADD CONSTRAINT "review_complaints_volunteer_rating_id_volunteer_ratings_id_fk" FOREIGN KEY ("volunteer_rating_id") REFERENCES "public"."volunteer_ratings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_complaints" ADD CONSTRAINT "review_complaints_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_complaints" ADD CONSTRAINT "review_complaints_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_complaints" ADD CONSTRAINT "review_complaints_complainant_id_users_id_fk" FOREIGN KEY ("complainant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_complaints" ADD CONSTRAINT "review_complaints_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "review_complaints_event_feedback_idx" ON "review_complaints" USING btree ("event_feedback_id");
  CREATE INDEX "review_complaints_volunteer_rating_idx" ON "review_complaints" USING btree ("volunteer_rating_id");
  CREATE INDEX "review_complaints_event_idx" ON "review_complaints" USING btree ("event_id");
  CREATE INDEX "review_complaints_municipality_idx" ON "review_complaints" USING btree ("municipality_id");
  CREATE INDEX "review_complaints_complainant_idx" ON "review_complaints" USING btree ("complainant_id");
  CREATE INDEX "review_complaints_decided_by_idx" ON "review_complaints" USING btree ("decided_by_id");
  CREATE INDEX "review_complaints_updated_at_idx" ON "review_complaints" USING btree ("updated_at");
  CREATE INDEX "review_complaints_created_at_idx" ON "review_complaints" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_review_complaints_fk" FOREIGN KEY ("review_complaints_id") REFERENCES "public"."review_complaints"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_review_complaints_id_idx" ON "payload_locked_documents_rels" USING btree ("review_complaints_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "review_complaints" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "review_complaints" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_review_complaints_fk";
  
  DROP INDEX "payload_locked_documents_rels_review_complaints_id_idx";
  ALTER TABLE "volunteer_ratings" DROP COLUMN "deleted_at";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "review_complaints_id";
  DROP TYPE "public"."enum_review_complaints_review_type";
  DROP TYPE "public"."enum_review_complaints_status";`)
}
