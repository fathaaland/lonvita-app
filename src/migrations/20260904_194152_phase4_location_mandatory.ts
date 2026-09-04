import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "events" ALTER COLUMN "lat" SET NOT NULL;
  ALTER TABLE "events" ALTER COLUMN "lng" SET NOT NULL;
  ALTER TABLE "municipalities" ADD COLUMN "lat" numeric;
  ALTER TABLE "municipalities" ADD COLUMN "lng" numeric;
  -- Backfill existing municipalities (created before location became mandatory, brief §4
  -- "poloha je mandatory field") with Žďár nad Sázavou's coordinates — the town used
  -- throughout the product brief's own examples — before enforcing NOT NULL below. A real
  -- deployment would want to re-pin these properly via the superadmin map picker afterwards.
  UPDATE "municipalities" SET "lat" = 49.5661, "lng" = 15.9403 WHERE "lat" IS NULL;
  ALTER TABLE "municipalities" ALTER COLUMN "lat" SET NOT NULL;
  ALTER TABLE "municipalities" ALTER COLUMN "lng" SET NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "events" ALTER COLUMN "lat" DROP NOT NULL;
  ALTER TABLE "events" ALTER COLUMN "lng" DROP NOT NULL;
  ALTER TABLE "municipalities" DROP COLUMN "lat";
  ALTER TABLE "municipalities" DROP COLUMN "lng";`)
}
