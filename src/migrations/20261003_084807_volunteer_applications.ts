import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_volunteer_invitations_kind" AS ENUM('invitation', 'application');
  ALTER TABLE "volunteer_invitations" ADD COLUMN "kind" "enum_volunteer_invitations_kind" DEFAULT 'invitation' NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "volunteer_invitations" DROP COLUMN "kind";
  DROP TYPE "public"."enum_volunteer_invitations_kind";`)
}
