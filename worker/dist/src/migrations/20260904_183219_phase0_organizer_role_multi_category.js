import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   CREATE TYPE "public"."enum_municipalities_rules_for_creation" AS ENUM('municipality_only', 'anyone', 'approved_organizers');
  ALTER TYPE "public"."enum_user_roles_role" ADD VALUE 'organizer' BEFORE 'prescriber';
  CREATE TABLE "events_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"event_categories_id" integer
  );
  
  ALTER TABLE "events" DROP CONSTRAINT "events_category_id_event_categories_id_fk";

  DROP INDEX "events_category_idx";
  ALTER TABLE "municipalities" ADD COLUMN "rules_for_creation" "enum_municipalities_rules_for_creation" DEFAULT 'approved_organizers' NOT NULL;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_event_categories_fk" FOREIGN KEY ("event_categories_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_rels_order_idx" ON "events_rels" USING btree ("order");
  CREATE INDEX "events_rels_parent_idx" ON "events_rels" USING btree ("parent_id");
  CREATE INDEX "events_rels_path_idx" ON "events_rels" USING btree ("path");
  CREATE INDEX "events_rels_event_categories_id_idx" ON "events_rels" USING btree ("event_categories_id");
  -- Production predates the "name" uniqueness rule and already has rows sharing a
  -- name, so merge those into one survivor (lowest id) and repoint every existing
  -- reference before the unique index below can be created.
  WITH keepers AS (
    SELECT id, name, MIN(id) OVER (PARTITION BY name) AS keeper_id FROM "event_categories"
  )
  UPDATE "events" e SET "category_id" = k.keeper_id
  FROM keepers k WHERE e."category_id" = k.id AND k.id <> k.keeper_id;

  WITH keepers AS (
    SELECT id, name, MIN(id) OVER (PARTITION BY name) AS keeper_id FROM "event_categories"
  )
  UPDATE "profiles_rels" pr SET "event_categories_id" = k.keeper_id
  FROM keepers k WHERE pr."event_categories_id" = k.id AND k.id <> k.keeper_id;

  -- Drop interest rows left duplicated when the remap above collapsed two
  -- categories a profile already had into the same surviving category.
  DELETE FROM "profiles_rels" pr USING "profiles_rels" pr2
  WHERE pr."path" = 'interests' AND pr2."path" = 'interests'
    AND pr."parent_id" = pr2."parent_id"
    AND pr."event_categories_id" = pr2."event_categories_id"
    AND pr.id > pr2.id;

  -- Locked-document rows only track who is mid-edit in the admin UI, so drop
  -- rather than remap any pointing at a category about to be removed.
  WITH keepers AS (
    SELECT id, name, MIN(id) OVER (PARTITION BY name) AS keeper_id FROM "event_categories"
  )
  DELETE FROM "payload_locked_documents_rels" plr USING keepers k
  WHERE plr."event_categories_id" = k.id AND k.id <> k.keeper_id;

  WITH keepers AS (
    SELECT id, name, MIN(id) OVER (PARTITION BY name) AS keeper_id FROM "event_categories"
  )
  DELETE FROM "event_categories" ec USING keepers k
  WHERE ec.id = k.id AND k.id <> k.keeper_id;

  CREATE UNIQUE INDEX "event_categories_name_idx" ON "event_categories" USING btree ("name");
  -- Carry each event's existing single category forward into the new hasMany join table
  -- before dropping the old column, so existing events don't lose their category.
  INSERT INTO "events_rels" ("order", "parent_id", "path", "event_categories_id")
  SELECT 1, "id", 'categories', "category_id" FROM "events" WHERE "category_id" IS NOT NULL;
  ALTER TABLE "events" DROP COLUMN "category_id";`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   DROP INDEX "event_categories_name_idx";
  ALTER TABLE "events" ADD COLUMN "category_id" integer;
  -- Best-effort backfill from the join table before it's dropped below (a hasMany
  -- collapsing back to a single relationship necessarily drops any extras per event).
  UPDATE "events" e SET "category_id" = sub."event_categories_id"
  FROM (SELECT DISTINCT ON ("parent_id") "parent_id", "event_categories_id" FROM "events_rels" WHERE "path" = 'categories' ORDER BY "parent_id", "order") sub
  WHERE e."id" = sub."parent_id";
  ALTER TABLE "events" ALTER COLUMN "category_id" SET NOT NULL;
  ALTER TABLE "events" ADD CONSTRAINT "events_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "events_category_idx" ON "events" USING btree ("category_id");
  ALTER TABLE "events_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "events_rels" CASCADE;
  ALTER TABLE "user_roles" ALTER COLUMN "role" SET DATA TYPE text;
  DROP TYPE "public"."enum_user_roles_role";
  CREATE TYPE "public"."enum_user_roles_role" AS ENUM('participant', 'municipality_admin', 'prescriber');
  ALTER TABLE "user_roles" ALTER COLUMN "role" SET DATA TYPE "public"."enum_user_roles_role" USING "role"::"public"."enum_user_roles_role";
  ALTER TABLE "municipalities" DROP COLUMN "rules_for_creation";
  DROP TYPE "public"."enum_municipalities_rules_for_creation";`);
}
