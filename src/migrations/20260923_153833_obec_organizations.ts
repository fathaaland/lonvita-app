import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_co_organizing_requests_status" AS ENUM('pending', 'approved', 'rejected');
  ALTER TYPE "public"."enum_organizations_type" RENAME TO "enum_organizations_type_old";
  CREATE TYPE "public"."enum_organizations_type" AS ENUM('business', 'association', 'individual', 'municipality');
  ALTER TABLE "organizations" ALTER COLUMN "type" DROP DEFAULT;
  ALTER TABLE "organizations" ALTER COLUMN "type" SET DATA TYPE "public"."enum_organizations_type" USING "type"::text::"public"."enum_organizations_type";
  ALTER TABLE "organizations" ALTER COLUMN "type" SET DEFAULT 'individual';
  DROP TYPE "public"."enum_organizations_type_old";
  CREATE TABLE "co_organizing_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"event_title" varchar NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"requested_by_id" integer NOT NULL,
  	"status" "enum_co_organizing_requests_status" DEFAULT 'pending' NOT NULL,
  	"reviewed_by_id" integer,
  	"reviewed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "organizations" ALTER COLUMN "owner_id" DROP NOT NULL;
  ALTER TABLE "event_deletion_requests" ADD COLUMN "municipality_consent" boolean DEFAULT false;
  ALTER TABLE "event_deletion_requests" ADD COLUMN "municipality_approved_by_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "co_organizing_requests_id" integer;
  ALTER TABLE "co_organizing_requests" ADD CONSTRAINT "co_organizing_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "co_organizing_requests" ADD CONSTRAINT "co_organizing_requests_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "co_organizing_requests" ADD CONSTRAINT "co_organizing_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "co_organizing_requests" ADD CONSTRAINT "co_organizing_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "co_organizing_requests_event_idx" ON "co_organizing_requests" USING btree ("event_id");
  CREATE INDEX "co_organizing_requests_municipality_idx" ON "co_organizing_requests" USING btree ("municipality_id");
  CREATE INDEX "co_organizing_requests_requested_by_idx" ON "co_organizing_requests" USING btree ("requested_by_id");
  CREATE INDEX "co_organizing_requests_reviewed_by_idx" ON "co_organizing_requests" USING btree ("reviewed_by_id");
  CREATE INDEX "co_organizing_requests_updated_at_idx" ON "co_organizing_requests" USING btree ("updated_at");
  CREATE INDEX "co_organizing_requests_created_at_idx" ON "co_organizing_requests" USING btree ("created_at");
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_municipality_approved_by_id_users_id_fk" FOREIGN KEY ("municipality_approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_co_organizing_requests_fk" FOREIGN KEY ("co_organizing_requests_id") REFERENCES "public"."co_organizing_requests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "event_deletion_requests_municipality_approved_by_idx" ON "event_deletion_requests" USING btree ("municipality_approved_by_id");
  CREATE INDEX "payload_locked_documents_rels_co_organizing_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("co_organizing_requests_id");`)

  // Every obec gets its own organization (no owner — it belongs to the obec), named after it.
  await db.execute(sql`
  INSERT INTO "organizations" ("name", "type", "owner_id", "municipality_id")
  SELECT m."name", 'municipality', NULL, m."id"
  FROM "municipalities" m
  WHERE NOT EXISTS (
    SELECT 1 FROM "organizations" o WHERE o."municipality_id" = m."id" AND o."type" = 'municipality'
  );`)

  // The obec's own events (founded by its admin, run as nobody so far) are now run as the obec.
  await db.execute(sql`
  UPDATE "events" e SET "organization_id" = o."id"
  FROM "organizations" o
  WHERE e."organization_id" IS NULL
    AND o."municipality_id" = e."municipality_id" AND o."type" = 'municipality'
    AND EXISTS (
      SELECT 1 FROM "user_roles" ur
      WHERE ur."user_id" = e."organizer_id" AND ur."municipality_id" = e."municipality_id"
        AND ur."role" = 'municipality_admin'
    );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // The obec organizations can't survive the old enum or NOT NULL owner — events run as the obec go
  // back to being run as nobody, and the obec drops off as a spolupořadatel.
  await db.execute(sql`
  UPDATE "events" e SET "organization_id" = NULL
  FROM "organizations" o
  WHERE o."id" = e."organization_id" AND o."type" = 'municipality';
  DELETE FROM "events_rels" r
  USING "organizations" o
  WHERE o."id" = r."organizations_id" AND o."type" = 'municipality';
  DELETE FROM "organizations" WHERE "type" = 'municipality';`)

  await db.execute(sql`
   ALTER TABLE "co_organizing_requests" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "co_organizing_requests" CASCADE;
  ALTER TABLE "event_deletion_requests" DROP CONSTRAINT "event_deletion_requests_municipality_approved_by_id_users_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_co_organizing_requests_fk";
  
  ALTER TABLE "organizations" ALTER COLUMN "type" SET DATA TYPE text;
  ALTER TABLE "organizations" ALTER COLUMN "type" SET DEFAULT 'individual'::text;
  DROP TYPE "public"."enum_organizations_type";
  CREATE TYPE "public"."enum_organizations_type" AS ENUM('business', 'association', 'individual');
  ALTER TABLE "organizations" ALTER COLUMN "type" SET DEFAULT 'individual'::"public"."enum_organizations_type";
  ALTER TABLE "organizations" ALTER COLUMN "type" SET DATA TYPE "public"."enum_organizations_type" USING "type"::"public"."enum_organizations_type";
  DROP INDEX "event_deletion_requests_municipality_approved_by_idx";
  DROP INDEX "payload_locked_documents_rels_co_organizing_requests_id_idx";
  ALTER TABLE "organizations" ALTER COLUMN "owner_id" SET NOT NULL;
  ALTER TABLE "event_deletion_requests" DROP COLUMN "municipality_consent";
  ALTER TABLE "event_deletion_requests" DROP COLUMN "municipality_approved_by_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "co_organizing_requests_id";
  DROP TYPE "public"."enum_co_organizing_requests_status";`)
}
