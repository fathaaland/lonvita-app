import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_organizer_requests_organization_type" AS ENUM('business', 'association', 'individual');
  CREATE TYPE "public"."enum_organizations_type" AS ENUM('business', 'association', 'individual');
  CREATE TABLE "organizations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"type" "enum_organizations_type" DEFAULT 'individual' NOT NULL,
  	"owner_id" integer NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "events" ADD COLUMN "organization_id" integer;
  ALTER TABLE "events_rels" ADD COLUMN "organizations_id" integer;
  ALTER TABLE "organizer_requests" ADD COLUMN "organization_name" varchar;
  ALTER TABLE "organizer_requests" ADD COLUMN "organization_type" "enum_organizer_requests_organization_type";
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "organizations_id" integer;
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_id");
  CREATE INDEX "organizations_municipality_idx" ON "organizations" USING btree ("municipality_id");
  CREATE INDEX "organizations_updated_at_idx" ON "organizations" USING btree ("updated_at");
  CREATE INDEX "organizations_created_at_idx" ON "organizations" USING btree ("created_at");
  ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_organizations_fk" FOREIGN KEY ("organizations_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organizations_fk" FOREIGN KEY ("organizations_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_organization_idx" ON "events" USING btree ("organization_id");
  CREATE INDEX "events_rels_organizations_id_idx" ON "events_rels" USING btree ("organizations_id");
  CREATE INDEX "payload_locked_documents_rels_organizations_id_idx" ON "payload_locked_documents_rels" USING btree ("organizations_id");`)

  // Every current organizer gets their organization in each obec they organize in — an
  // "individual" under their own name, which they (or the obec) can rename later.
  await db.execute(sql`
  INSERT INTO "organizations" ("name", "type", "owner_id", "municipality_id")
  SELECT DISTINCT ON (ur."user_id", ur."municipality_id")
    COALESCE(NULLIF(TRIM(p."full_name"), ''), 'Pořadatel'), 'individual', ur."user_id", ur."municipality_id"
  FROM "user_roles" ur
  LEFT JOIN "profiles" p ON p."user_id" = ur."user_id"
  WHERE ur."role" = 'organizer' AND ur."user_id" IS NOT NULL AND ur."municipality_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "organizations" o
      WHERE o."owner_id" = ur."user_id" AND o."municipality_id" = ur."municipality_id"
    )
  ORDER BY ur."user_id", ur."municipality_id", p."id";`)

  // What each event is run as — none for the obec's own events (founded by its admin).
  await db.execute(sql`
  UPDATE "events" e SET "organization_id" = o."id"
  FROM "organizations" o
  WHERE o."owner_id" = e."organizer_id" AND o."municipality_id" = e."municipality_id"
    AND NOT EXISTS (
      SELECT 1 FROM "user_roles" ur
      WHERE ur."user_id" = e."organizer_id" AND ur."municipality_id" = e."municipality_id"
        AND ur."role" = 'municipality_admin'
    );`)

  // Spolupořadatelé go organization to organization now: each co-organizing user becomes their
  // organization in the event's obec. Someone without one there (the obec's admin — the obec can't
  // co-organize any more) drops off, so the derived coOrganizers stay in step with coOrganizations.
  await db.execute(sql`
  INSERT INTO "events_rels" ("order", "parent_id", "path", "organizations_id")
  SELECT r."order", r."parent_id", 'coOrganizations', o."id"
  FROM "events_rels" r
  JOIN "events" e ON e."id" = r."parent_id"
  JOIN "organizations" o ON o."owner_id" = r."users_id" AND o."municipality_id" = e."municipality_id"
  WHERE r."path" = 'coOrganizers';

  DELETE FROM "events_rels" r
  USING "events" e
  WHERE e."id" = r."parent_id" AND r."path" = 'coOrganizers'
    AND NOT EXISTS (
      SELECT 1 FROM "organizations" o
      WHERE o."owner_id" = r."users_id" AND o."municipality_id" = e."municipality_id"
    );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "organizations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "organizations" CASCADE;
  ALTER TABLE "events" DROP CONSTRAINT "events_organization_id_organizations_id_fk";
  
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_organizations_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_organizations_fk";
  
  DROP INDEX "events_organization_idx";
  DROP INDEX "events_rels_organizations_id_idx";
  DROP INDEX "payload_locked_documents_rels_organizations_id_idx";
  ALTER TABLE "events" DROP COLUMN "organization_id";
  ALTER TABLE "events_rels" DROP COLUMN "organizations_id";
  ALTER TABLE "organizer_requests" DROP COLUMN "organization_name";
  ALTER TABLE "organizer_requests" DROP COLUMN "organization_type";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "organizations_id";
  DROP TYPE "public"."enum_organizer_requests_organization_type";
  DROP TYPE "public"."enum_organizations_type";`)
}
