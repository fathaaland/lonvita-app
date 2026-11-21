import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Organizers reach the volunteer pool only once the obec lets them (UserRoles.volunteerAccess,
 * OrganizerRequests kind/volunteerAccess*). Organizers who already hold the role keep the access
 * they had — only new ones are asked. Idempotent: columns and type are added only if missing, and
 * the backfill runs only while the column is being added.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  DO $$ BEGIN
    CREATE TYPE "public"."enum_organizer_requests_kind" AS ENUM('role', 'volunteer_access');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'user_roles' AND column_name = 'volunteer_access'
    ) THEN
      ALTER TABLE "user_roles" ADD COLUMN "volunteer_access" boolean DEFAULT false;
      UPDATE "user_roles" SET "volunteer_access" = true WHERE "role" = 'organizer';
    END IF;
  END $$;
  ALTER TABLE "organizer_requests" ADD COLUMN IF NOT EXISTS "kind" "enum_organizer_requests_kind" DEFAULT 'role';
  UPDATE "organizer_requests" SET "kind" = 'role' WHERE "kind" IS NULL;
  ALTER TABLE "organizer_requests" ADD COLUMN IF NOT EXISTS "volunteer_access_requested" boolean DEFAULT false;
  ALTER TABLE "organizer_requests" ADD COLUMN IF NOT EXISTS "volunteer_access_granted" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "user_roles" DROP COLUMN IF EXISTS "volunteer_access";
  ALTER TABLE "organizer_requests" DROP COLUMN IF EXISTS "kind";
  ALTER TABLE "organizer_requests" DROP COLUMN IF EXISTS "volunteer_access_requested";
  ALTER TABLE "organizer_requests" DROP COLUMN IF EXISTS "volunteer_access_granted";
  DROP TYPE IF EXISTS "public"."enum_organizer_requests_kind";`)
}
