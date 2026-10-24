import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "microregions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"main_municipality_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "microregions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"municipalities_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "microregions_id" integer;
  ALTER TABLE "microregions" ADD CONSTRAINT "microregions_main_municipality_id_municipalities_id_fk" FOREIGN KEY ("main_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "microregions_rels" ADD CONSTRAINT "microregions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."microregions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "microregions_rels" ADD CONSTRAINT "microregions_rels_municipalities_fk" FOREIGN KEY ("municipalities_id") REFERENCES "public"."municipalities"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "microregions_main_municipality_idx" ON "microregions" USING btree ("main_municipality_id");
  CREATE INDEX "microregions_updated_at_idx" ON "microregions" USING btree ("updated_at");
  CREATE INDEX "microregions_created_at_idx" ON "microregions" USING btree ("created_at");
  CREATE INDEX "microregions_rels_order_idx" ON "microregions_rels" USING btree ("order");
  CREATE INDEX "microregions_rels_parent_idx" ON "microregions_rels" USING btree ("parent_id");
  CREATE INDEX "microregions_rels_path_idx" ON "microregions_rels" USING btree ("path");
  CREATE INDEX "microregions_rels_municipalities_id_idx" ON "microregions_rels" USING btree ("municipalities_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_microregions_fk" FOREIGN KEY ("microregions_id") REFERENCES "public"."microregions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_microregions_id_idx" ON "payload_locked_documents_rels" USING btree ("microregions_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "microregions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "microregions_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "microregions" CASCADE;
  DROP TABLE "microregions_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_microregions_fk";
  
  DROP INDEX "payload_locked_documents_rels_microregions_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "microregions_id";`)
}
