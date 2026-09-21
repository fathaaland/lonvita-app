import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   CREATE TYPE "public"."enum_events_accessibility_tags" AS ENUM('wheelchair_access', 'induction_loop', 'seating', 'accessible_wc');
  CREATE TYPE "public"."enum_events_registration_approval_mode" AS ENUM('auto', 'manual');
  CREATE TABLE "events_accessibility_tags" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_events_accessibility_tags",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "organizations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  -- This partial unique index's WHERE clause references "status" (see payload.config.ts's
  -- afterSchemaInit) — it has to go before the column's type changes underneath it, and come
  -- back after, or Postgres is left comparing text to the old enum type mid-migration.
  DROP INDEX "registrations_active_event_user_idx";
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_registrations_status";
  CREATE TYPE "public"."enum_registrations_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_registrations_status";
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DATA TYPE "public"."enum_registrations_status" USING "status"::"public"."enum_registrations_status";
  CREATE UNIQUE INDEX "registrations_active_event_user_idx" ON "registrations" USING btree ("event_id", "user_id") WHERE "status" != 'cancelled';
  ALTER TABLE "media" ADD COLUMN "sizes_card_url" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_card_width" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_card_height" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_card_mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_card_filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_card_filename" varchar;
  ALTER TABLE "events" ADD COLUMN "end_date_time" timestamp(3) with time zone;
  ALTER TABLE "events" ADD COLUMN "recurrence_rule" varchar;
  ALTER TABLE "events" ADD COLUMN "recurrence_parent_id" integer;
  ALTER TABLE "events" ADD COLUMN "registration_approval_mode" "enum_events_registration_approval_mode" DEFAULT 'manual' NOT NULL;
  ALTER TABLE "events" ADD COLUMN "organization_id" integer;
  ALTER TABLE "events_rels" ADD COLUMN "users_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "organizations_id" integer;
  ALTER TABLE "events_accessibility_tags" ADD CONSTRAINT "events_accessibility_tags_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "events_accessibility_tags_order_idx" ON "events_accessibility_tags" USING btree ("order");
  CREATE INDEX "events_accessibility_tags_parent_idx" ON "events_accessibility_tags" USING btree ("parent_id");
  CREATE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_id");
  CREATE INDEX "organizations_updated_at_idx" ON "organizations" USING btree ("updated_at");
  CREATE INDEX "organizations_created_at_idx" ON "organizations" USING btree ("created_at");
  ALTER TABLE "events" ADD CONSTRAINT "events_recurrence_parent_id_events_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organizations_fk" FOREIGN KEY ("organizations_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "media_sizes_card_sizes_card_filename_idx" ON "media" USING btree ("sizes_card_filename");
  CREATE INDEX "events_recurrence_parent_idx" ON "events" USING btree ("recurrence_parent_id");
  CREATE INDEX "events_organization_idx" ON "events" USING btree ("organization_id");
  CREATE INDEX "events_rels_users_id_idx" ON "events_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_organizations_id_idx" ON "payload_locked_documents_rels" USING btree ("organizations_id");
  ALTER TABLE "profiles" DROP COLUMN "payout_iban";
  ALTER TABLE "registrations" DROP COLUMN "payment_status";
  ALTER TABLE "registrations" DROP COLUMN "stripe_session_id";
  ALTER TABLE "registrations" DROP COLUMN "stripe_payment_intent_id";
  ALTER TABLE "registrations" DROP COLUMN "amount_paid_cents";
  ALTER TABLE "registrations" DROP COLUMN "refunded_at";
  DROP TYPE "public"."enum_registrations_payment_status";`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   CREATE TYPE "public"."enum_registrations_payment_status" AS ENUM('none', 'paid', 'refunded', 'failed');
  ALTER TYPE "public"."enum_registrations_status" ADD VALUE 'pending_payment' BEFORE 'pending';
  ALTER TABLE "events_accessibility_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "organizations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "events_accessibility_tags" CASCADE;
  DROP TABLE "organizations" CASCADE;
  ALTER TABLE "events" DROP CONSTRAINT "events_recurrence_parent_id_events_id_fk";
  
  ALTER TABLE "events" DROP CONSTRAINT "events_organization_id_organizations_id_fk";
  
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_users_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_organizations_fk";
  
  DROP INDEX "media_sizes_card_sizes_card_filename_idx";
  DROP INDEX "events_recurrence_parent_idx";
  DROP INDEX "events_organization_idx";
  DROP INDEX "events_rels_users_id_idx";
  DROP INDEX "payload_locked_documents_rels_organizations_id_idx";
  ALTER TABLE "profiles" ADD COLUMN "payout_iban" varchar;
  ALTER TABLE "registrations" ADD COLUMN "payment_status" "enum_registrations_payment_status" DEFAULT 'none' NOT NULL;
  ALTER TABLE "registrations" ADD COLUMN "stripe_session_id" varchar;
  ALTER TABLE "registrations" ADD COLUMN "stripe_payment_intent_id" varchar;
  ALTER TABLE "registrations" ADD COLUMN "amount_paid_cents" numeric;
  ALTER TABLE "registrations" ADD COLUMN "refunded_at" timestamp(3) with time zone;
  ALTER TABLE "media" DROP COLUMN "sizes_card_url";
  ALTER TABLE "media" DROP COLUMN "sizes_card_width";
  ALTER TABLE "media" DROP COLUMN "sizes_card_height";
  ALTER TABLE "media" DROP COLUMN "sizes_card_mime_type";
  ALTER TABLE "media" DROP COLUMN "sizes_card_filesize";
  ALTER TABLE "media" DROP COLUMN "sizes_card_filename";
  ALTER TABLE "events" DROP COLUMN "end_date_time";
  ALTER TABLE "events" DROP COLUMN "recurrence_rule";
  ALTER TABLE "events" DROP COLUMN "recurrence_parent_id";
  ALTER TABLE "events" DROP COLUMN "registration_approval_mode";
  ALTER TABLE "events" DROP COLUMN "organization_id";
  ALTER TABLE "events_rels" DROP COLUMN "users_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "organizations_id";
  DROP TYPE "public"."enum_events_accessibility_tags";
  DROP TYPE "public"."enum_events_registration_approval_mode";`);
}
