import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_deletion_requests" ADD COLUMN "requester_municipality_id" integer;
  ALTER TABLE "event_deletion_requests" ADD COLUMN "creator_only" boolean DEFAULT false;
  ALTER TABLE "event_deletion_requests_rels" ADD COLUMN "municipalities_id" integer;
  ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_requester_municipality_id_municipalities_id_fk" FOREIGN KEY ("requester_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_deletion_requests_rels" ADD CONSTRAINT "event_deletion_requests_rels_municipalities_fk" FOREIGN KEY ("municipalities_id") REFERENCES "public"."municipalities"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "event_deletion_requests_requester_municipality_idx" ON "event_deletion_requests" USING btree ("requester_municipality_id");
  CREATE INDEX "event_deletion_requests_rels_municipalities_id_idx" ON "event_deletion_requests_rels" USING btree ("municipalities_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_deletion_requests" DROP CONSTRAINT "event_deletion_requests_requester_municipality_id_municipalities_id_fk";
  
  ALTER TABLE "event_deletion_requests_rels" DROP CONSTRAINT "event_deletion_requests_rels_municipalities_fk";
  
  DROP INDEX "event_deletion_requests_requester_municipality_idx";
  DROP INDEX "event_deletion_requests_rels_municipalities_id_idx";
  ALTER TABLE "event_deletion_requests" DROP COLUMN "requester_municipality_id";
  ALTER TABLE "event_deletion_requests" DROP COLUMN "creator_only";
  ALTER TABLE "event_deletion_requests_rels" DROP COLUMN "municipalities_id";`)
}
