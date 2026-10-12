import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Drops what the app never used: the multi-tenant plugin's users.tenants, the event gallery
 * (event_media) and municipality areas nobody built screens for, and fields nothing reads —
 * profiles.phone_verified / home_area_id, events.recurrence_parent_id, registrations.attendance_note,
 * auth_identities.connection / profile. The Payload admin panel could still have written into any
 * of them, so the migration first counts what they hold and stops — rolling back, failing the
 * deploy — if anything is there: losing it should be a decision, not a side effect.
 */
const LEFTOVERS = sql`
  SELECT 'users_tenants' AS what, count(*) AS n FROM users_tenants
  UNION ALL SELECT 'event_media', count(*) FROM event_media
  UNION ALL SELECT 'municipality_areas', count(*) FROM municipality_areas
  UNION ALL SELECT 'profiles.phone_verified', count(*) FROM profiles WHERE phone_verified
  UNION ALL SELECT 'profiles.home_area_id', count(*) FROM profiles WHERE home_area_id IS NOT NULL
  UNION ALL SELECT 'events.recurrence_parent_id', count(*) FROM events WHERE recurrence_parent_id IS NOT NULL
  UNION ALL SELECT 'registrations.attendance_note', count(*) FROM registrations WHERE coalesce(attendance_note, '') <> ''
  UNION ALL SELECT 'auth_identities.connection', count(*) FROM auth_identities WHERE coalesce(connection, '') <> ''
  UNION ALL SELECT 'auth_identities.profile', count(*) FROM auth_identities WHERE profile IS NOT NULL
`

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  const { rows } = await db.execute(LEFTOVERS)
  const holding = (rows as { what: string; n: number | string }[]).filter((row) => Number(row.n) > 0)
  if (holding.length > 0) {
    throw new Error(
      `Schema cleanup stopped — these still hold data: ${holding.map((row) => `${row.what} (${row.n})`).join(', ')}. ` +
        'Keep it elsewhere or confirm it can go before running this migration.',
    )
  }

  // The CASCADE on the dropped tables already took the foreign keys pointing at them — hence IF EXISTS.
  await db.execute(sql`
   ALTER TABLE "users_tenants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "municipality_areas" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "users_tenants" CASCADE;
  DROP TABLE "event_media" CASCADE;
  DROP TABLE "municipality_areas" CASCADE;
  ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_home_area_id_municipality_areas_id_fk";
  
  ALTER TABLE "events" DROP CONSTRAINT "events_recurrence_parent_id_events_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_media_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_municipality_areas_fk";
  
  DROP INDEX "profiles_home_area_idx";
  DROP INDEX "events_recurrence_parent_idx";
  DROP INDEX "auth_identities_connection_idx";
  DROP INDEX "payload_locked_documents_rels_event_media_id_idx";
  DROP INDEX "payload_locked_documents_rels_municipality_areas_id_idx";
  ALTER TABLE "profiles" DROP COLUMN "phone_verified";
  ALTER TABLE "profiles" DROP COLUMN "home_area_id";
  ALTER TABLE "events" DROP COLUMN "recurrence_parent_id";
  ALTER TABLE "registrations" DROP COLUMN "attendance_note";
  ALTER TABLE "auth_identities" DROP COLUMN "connection";
  ALTER TABLE "auth_identities" DROP COLUMN "profile";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_media_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "municipality_areas_id";
  DROP TYPE "public"."enum_event_media_visibility";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_event_media_visibility" AS ENUM('private', 'municipality', 'public');
  CREATE TABLE "users_tenants" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tenant_id" integer NOT NULL
  );
  
  CREATE TABLE "event_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"media_id" integer NOT NULL,
  	"uploaded_by_id" integer NOT NULL,
  	"visibility" "enum_event_media_visibility" DEFAULT 'municipality' NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "municipality_areas" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"center_lat" numeric NOT NULL,
  	"center_lng" numeric NOT NULL,
  	"radius_m" numeric DEFAULT 400 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "profiles" ADD COLUMN "phone_verified" boolean DEFAULT false;
  ALTER TABLE "profiles" ADD COLUMN "home_area_id" integer;
  ALTER TABLE "events" ADD COLUMN "recurrence_parent_id" integer;
  ALTER TABLE "registrations" ADD COLUMN "attendance_note" varchar;
  ALTER TABLE "auth_identities" ADD COLUMN "connection" varchar;
  ALTER TABLE "auth_identities" ADD COLUMN "profile" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_media_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "municipality_areas_id" integer;
  ALTER TABLE "users_tenants" ADD CONSTRAINT "users_tenants_tenant_id_municipalities_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_tenants" ADD CONSTRAINT "users_tenants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "event_media" ADD CONSTRAINT "event_media_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_media" ADD CONSTRAINT "event_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_media" ADD CONSTRAINT "event_media_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "municipality_areas" ADD CONSTRAINT "municipality_areas_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "users_tenants_order_idx" ON "users_tenants" USING btree ("_order");
  CREATE INDEX "users_tenants_parent_id_idx" ON "users_tenants" USING btree ("_parent_id");
  CREATE INDEX "users_tenants_tenant_idx" ON "users_tenants" USING btree ("tenant_id");
  CREATE INDEX "event_media_event_idx" ON "event_media" USING btree ("event_id");
  CREATE INDEX "event_media_media_idx" ON "event_media" USING btree ("media_id");
  CREATE INDEX "event_media_uploaded_by_idx" ON "event_media" USING btree ("uploaded_by_id");
  CREATE INDEX "event_media_updated_at_idx" ON "event_media" USING btree ("updated_at");
  CREATE INDEX "event_media_created_at_idx" ON "event_media" USING btree ("created_at");
  CREATE INDEX "municipality_areas_municipality_idx" ON "municipality_areas" USING btree ("municipality_id");
  CREATE INDEX "municipality_areas_updated_at_idx" ON "municipality_areas" USING btree ("updated_at");
  CREATE INDEX "municipality_areas_created_at_idx" ON "municipality_areas" USING btree ("created_at");
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_home_area_id_municipality_areas_id_fk" FOREIGN KEY ("home_area_id") REFERENCES "public"."municipality_areas"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_recurrence_parent_id_events_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_media_fk" FOREIGN KEY ("event_media_id") REFERENCES "public"."event_media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_municipality_areas_fk" FOREIGN KEY ("municipality_areas_id") REFERENCES "public"."municipality_areas"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "profiles_home_area_idx" ON "profiles" USING btree ("home_area_id");
  CREATE INDEX "events_recurrence_parent_idx" ON "events" USING btree ("recurrence_parent_id");
  CREATE INDEX "auth_identities_connection_idx" ON "auth_identities" USING btree ("connection");
  CREATE INDEX "payload_locked_documents_rels_event_media_id_idx" ON "payload_locked_documents_rels" USING btree ("event_media_id");
  CREATE INDEX "payload_locked_documents_rels_municipality_areas_id_idx" ON "payload_locked_documents_rels" USING btree ("municipality_areas_id");`)
}
