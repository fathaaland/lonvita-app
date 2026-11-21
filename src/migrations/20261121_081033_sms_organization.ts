import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Additive and idempotent: a dev database Payload already pushed the column to just passes.
  await db.execute(sql`
  ALTER TABLE "sms_messages" ADD COLUMN IF NOT EXISTS "organization_id" integer;
  DO $$ BEGIN
    ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  CREATE INDEX IF NOT EXISTS "sms_messages_organization_idx" ON "sms_messages" USING btree ("organization_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sms_messages" DROP CONSTRAINT IF EXISTS "sms_messages_organization_id_organizations_id_fk";
  DROP INDEX IF EXISTS "sms_messages_organization_idx";
  ALTER TABLE "sms_messages" DROP COLUMN IF EXISTS "organization_id";`)
}
