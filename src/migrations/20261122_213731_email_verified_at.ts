import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Additive and idempotent: a dev database Payload already pushed the columns to just passes.
// No backfill on purpose — existing password accounts never proved their address, and
// link-account reads a null here as "unproven" (only finishing onboarding asks for the code, so
// accounts past onboarding aren't stopped by it). A null email_code_sent_at keeps every existing
// account out of the unverified-accounts retention rule.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp(3) with time zone;
  ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_code_sent_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "users" DROP COLUMN IF EXISTS "email_code_sent_at";
  ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at";`)
}
