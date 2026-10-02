import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "volunteer_ratings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"registration_id" integer NOT NULL,
  	"event_id" integer NOT NULL,
  	"event_title" varchar NOT NULL,
  	"volunteer_id" integer NOT NULL,
  	"rated_by_id" integer NOT NULL,
  	"rating" numeric NOT NULL,
  	"comment" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "profiles" ADD COLUMN "volunteer_municipality_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "volunteer_ratings_id" integer;
  ALTER TABLE "volunteer_ratings" ADD CONSTRAINT "volunteer_ratings_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_ratings" ADD CONSTRAINT "volunteer_ratings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_ratings" ADD CONSTRAINT "volunteer_ratings_volunteer_id_users_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "volunteer_ratings" ADD CONSTRAINT "volunteer_ratings_rated_by_id_users_id_fk" FOREIGN KEY ("rated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "volunteer_ratings_registration_idx" ON "volunteer_ratings" USING btree ("registration_id");
  CREATE INDEX "volunteer_ratings_event_idx" ON "volunteer_ratings" USING btree ("event_id");
  CREATE INDEX "volunteer_ratings_volunteer_idx" ON "volunteer_ratings" USING btree ("volunteer_id");
  CREATE INDEX "volunteer_ratings_rated_by_idx" ON "volunteer_ratings" USING btree ("rated_by_id");
  CREATE INDEX "volunteer_ratings_updated_at_idx" ON "volunteer_ratings" USING btree ("updated_at");
  CREATE INDEX "volunteer_ratings_created_at_idx" ON "volunteer_ratings" USING btree ("created_at");
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_volunteer_municipality_id_municipalities_id_fk" FOREIGN KEY ("volunteer_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_volunteer_ratings_fk" FOREIGN KEY ("volunteer_ratings_id") REFERENCES "public"."volunteer_ratings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "profiles_volunteer_municipality_idx" ON "profiles" USING btree ("volunteer_municipality_id");
  CREATE INDEX "payload_locked_documents_rels_volunteer_ratings_id_idx" ON "payload_locked_documents_rels" USING btree ("volunteer_ratings_id");
  -- Where a volunteer helps starts as their home obec — what the per-obec pool used until now.
  UPDATE "profiles" SET "volunteer_municipality_id" = "municipality_id" WHERE "municipality_id" IS NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "volunteer_ratings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "volunteer_ratings" CASCADE;
  ALTER TABLE "profiles" DROP CONSTRAINT "profiles_volunteer_municipality_id_municipalities_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_volunteer_ratings_fk";
  
  DROP INDEX "profiles_volunteer_municipality_idx";
  DROP INDEX "payload_locked_documents_rels_volunteer_ratings_id_idx";
  ALTER TABLE "profiles" DROP COLUMN "volunteer_municipality_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "volunteer_ratings_id";`)
}
