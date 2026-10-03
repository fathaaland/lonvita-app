import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // The flag no longer needs the obec's approval — the creator sets it. A request still waiting
  // came from the creator (only they could ask), so it's granted now rather than lost with the table.
  await db.execute(sql`
  UPDATE "events" SET "is_volunteering" = true
    WHERE "id" IN (SELECT "event_id" FROM "volunteer_flag_requests" WHERE "status" = 'pending')
      AND "deleted_at" IS NULL;`)

  // Drop the reference to "volunteer_flag_requests" before the table itself — the generated order
  // ran `DROP TABLE ... CASCADE` first, which already removes this FK, so the explicit
  // `DROP CONSTRAINT` after it would fail with "constraint does not exist".
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_volunteer_flag_requests_fk";
  DROP INDEX "payload_locked_documents_rels_volunteer_flag_requests_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "volunteer_flag_requests_id";
  ALTER TABLE "volunteer_flag_requests" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "volunteer_flag_requests";
  DROP TYPE "public"."enum_volunteer_flag_requests_status";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_volunteer_flag_requests_status" AS ENUM('pending', 'approved', 'rejected');
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
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "volunteer_flag_requests_id" integer;
  ALTER TABLE "volunteer_flag_requests" ADD CONSTRAINT "volunteer_flag_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_flag_requests" ADD CONSTRAINT "volunteer_flag_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_flag_requests" ADD CONSTRAINT "volunteer_flag_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "volunteer_flag_requests_event_idx" ON "volunteer_flag_requests" USING btree ("event_id");
  CREATE INDEX "volunteer_flag_requests_requested_by_idx" ON "volunteer_flag_requests" USING btree ("requested_by_id");
  CREATE INDEX "volunteer_flag_requests_reviewed_by_idx" ON "volunteer_flag_requests" USING btree ("reviewed_by_id");
  CREATE INDEX "volunteer_flag_requests_updated_at_idx" ON "volunteer_flag_requests" USING btree ("updated_at");
  CREATE INDEX "volunteer_flag_requests_created_at_idx" ON "volunteer_flag_requests" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_volunteer_flag_requests_fk" FOREIGN KEY ("volunteer_flag_requests_id") REFERENCES "public"."volunteer_flag_requests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_volunteer_flag_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("volunteer_flag_requests_id");`)
}
