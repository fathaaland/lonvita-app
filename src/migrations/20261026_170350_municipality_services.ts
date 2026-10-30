import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "sms_messages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer,
  	"request_id" varchar,
  	"provider_message_sid" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "municipalities" ADD COLUMN "email_price_czk" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "sms_enabled" boolean DEFAULT false;
  ALTER TABLE "municipalities" ADD COLUMN "sms_price_czk" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "sms_monthly_limit" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "import_ai_enabled" boolean DEFAULT false;
  ALTER TABLE "municipalities" ADD COLUMN "import_ai_price_czk" numeric;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sms_messages_id" integer;
  ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "sms_messages_municipality_idx" ON "sms_messages" USING btree ("municipality_id");
  CREATE INDEX "sms_messages_updated_at_idx" ON "sms_messages" USING btree ("updated_at");
  CREATE INDEX "sms_messages_created_at_idx" ON "sms_messages" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sms_messages_fk" FOREIGN KEY ("sms_messages_id") REFERENCES "public"."sms_messages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_sms_messages_id_idx" ON "payload_locked_documents_rels" USING btree ("sms_messages_id");`)

  // The obce there already had SMS and the AI import before either became a paid service — they keep
  // both until the platform sets what each pays for. A new obec starts with neither.
  await db.execute(sql`
   UPDATE "municipalities" SET "sms_enabled" = true, "import_ai_enabled" = true;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sms_messages" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sms_messages" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sms_messages_fk";
  
  DROP INDEX "payload_locked_documents_rels_sms_messages_id_idx";
  ALTER TABLE "municipalities" DROP COLUMN "email_price_czk";
  ALTER TABLE "municipalities" DROP COLUMN "sms_enabled";
  ALTER TABLE "municipalities" DROP COLUMN "sms_price_czk";
  ALTER TABLE "municipalities" DROP COLUMN "sms_monthly_limit";
  ALTER TABLE "municipalities" DROP COLUMN "import_ai_enabled";
  ALTER TABLE "municipalities" DROP COLUMN "import_ai_price_czk";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sms_messages_id";`)
}
