import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "licence_upgrades" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"municipality_id" integer NOT NULL,
  	"period_key" varchar NOT NULL,
  	"from_tier" numeric NOT NULL,
  	"to_tier" numeric NOT NULL,
  	"average_users" numeric NOT NULL,
  	"effective_from" timestamp(3) with time zone NOT NULL,
  	"months_charged" numeric NOT NULL,
  	"period_months" numeric NOT NULL,
  	"from_yearly_czk" numeric NOT NULL,
  	"to_yearly_czk" numeric NOT NULL,
  	"surcharge_czk" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "municipalities" ADD COLUMN "licence_billed_tier" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "licence_billed_tier_period" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "licence_upgrades_id" integer;
  ALTER TABLE "licence_upgrades" ADD CONSTRAINT "licence_upgrades_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "licence_upgrades_municipality_idx" ON "licence_upgrades" USING btree ("municipality_id");
  CREATE INDEX "licence_upgrades_updated_at_idx" ON "licence_upgrades" USING btree ("updated_at");
  CREATE INDEX "licence_upgrades_created_at_idx" ON "licence_upgrades" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_licence_upgrades_fk" FOREIGN KEY ("licence_upgrades_id") REFERENCES "public"."licence_upgrades"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_licence_upgrades_id_idx" ON "payload_locked_documents_rels" USING btree ("licence_upgrades_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "licence_upgrades" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "licence_upgrades" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_licence_upgrades_fk";
  
  DROP INDEX "payload_locked_documents_rels_licence_upgrades_id_idx";
  ALTER TABLE "municipalities" DROP COLUMN "licence_billed_tier";
  ALTER TABLE "municipalities" DROP COLUMN "licence_billed_tier_period";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "licence_upgrades_id";`)
}
