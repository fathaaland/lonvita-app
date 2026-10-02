import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "co_organizing_requests" ADD COLUMN "organization_id" integer;
  ALTER TABLE "co_organizing_requests" ADD COLUMN "organization_name" varchar;
  ALTER TABLE "co_organizing_requests" ADD COLUMN "organization_owner_id" integer;
  -- Every request so far asked the obec itself (the only one that needed consent), so it invited
  -- the obec's own organization. One without it can't be answered for — it goes.
  UPDATE "co_organizing_requests" r
    SET "organization_id" = o."id", "organization_name" = o."name"
    FROM "organizations" o
    WHERE o."municipality_id" = r."municipality_id" AND o."type" = 'municipality';
  DELETE FROM "co_organizing_requests" WHERE "organization_id" IS NULL;
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "organization_id" SET NOT NULL;
  ALTER TABLE "co_organizing_requests" ALTER COLUMN "organization_name" SET NOT NULL;
  ALTER TABLE "co_organizing_requests" ADD CONSTRAINT "co_organizing_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "co_organizing_requests" ADD CONSTRAINT "co_organizing_requests_organization_owner_id_users_id_fk" FOREIGN KEY ("organization_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "co_organizing_requests_organization_idx" ON "co_organizing_requests" USING btree ("organization_id");
  CREATE INDEX "co_organizing_requests_organization_owner_idx" ON "co_organizing_requests" USING btree ("organization_owner_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "co_organizing_requests" DROP CONSTRAINT "co_organizing_requests_organization_id_organizations_id_fk";
  
  ALTER TABLE "co_organizing_requests" DROP CONSTRAINT "co_organizing_requests_organization_owner_id_users_id_fk";
  
  DROP INDEX "co_organizing_requests_organization_idx";
  DROP INDEX "co_organizing_requests_organization_owner_idx";
  ALTER TABLE "co_organizing_requests" DROP COLUMN "organization_id";
  ALTER TABLE "co_organizing_requests" DROP COLUMN "organization_name";
  ALTER TABLE "co_organizing_requests" DROP COLUMN "organization_owner_id";`)
}
