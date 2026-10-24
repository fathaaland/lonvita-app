import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "events" ADD COLUMN "is_draft" boolean DEFAULT false;
  CREATE INDEX "events_is_draft_idx" ON "events" USING btree ("is_draft");`)
  // "Put on hold" gives way to drafts: an event on hold nobody is on yet becomes its creator's draft;
  // one with participants, volunteers or spolupořadatelé is published again (it can't be a draft).
  // is_hidden stays as it was for the version still running during the deploy — removed later.
  await db.execute(sql`
  UPDATE "events" e SET "is_draft" = true
  WHERE e."is_hidden" = true
    AND e."deleted_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "registrations" r WHERE r."event_id" = e."id" AND r."status" IN ('pending', 'approved'))
    AND NOT EXISTS (SELECT 1 FROM "volunteer_invitations" v WHERE v."event_id" = e."id" AND v."status" IN ('pending', 'accepted'))
    AND NOT EXISTS (SELECT 1 FROM "events_rels" x WHERE x."parent_id" = e."id" AND x."path" IN ('coOrganizers', 'coOrganizations'));`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "events_is_draft_idx";
  ALTER TABLE "events" DROP COLUMN "is_draft";`)
}
