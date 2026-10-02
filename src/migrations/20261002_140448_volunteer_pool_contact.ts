import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "profiles" ADD COLUMN "volunteer_allow_email" boolean DEFAULT false;
  ALTER TABLE "profiles" ADD COLUMN "volunteer_contact_email" varchar;
  ALTER TABLE "profiles" ADD COLUMN "volunteer_allow_phone" boolean DEFAULT false;
  ALTER TABLE "profiles" ADD COLUMN "volunteer_contact_phone" varchar;
  -- Volunteers so far gave the obec their profile phone; keep reaching them on it. Whoever had no
  -- phone gets their account e-mail instead — every volunteer needs at least one channel.
  UPDATE "profiles" SET
    "volunteer_contact_phone" = "phone",
    "volunteer_allow_phone" = true
    WHERE "phone" IS NOT NULL AND length(regexp_replace("phone", '[^0-9]', '', 'g')) >= 9;
  UPDATE "profiles" p SET
    "volunteer_contact_email" = u."email",
    "volunteer_allow_email" = NOT p."volunteer_allow_phone"
    FROM "users" u
    WHERE u."id" = p."user_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "profiles" DROP COLUMN "volunteer_allow_email";
  ALTER TABLE "profiles" DROP COLUMN "volunteer_contact_email";
  ALTER TABLE "profiles" DROP COLUMN "volunteer_allow_phone";
  ALTER TABLE "profiles" DROP COLUMN "volunteer_contact_phone";`)
}
