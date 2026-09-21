import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "profiles" ADD COLUMN "phone_verified" boolean DEFAULT false;
  ALTER TABLE "profiles" ADD COLUMN "notify_email" boolean DEFAULT true;
  ALTER TABLE "profiles" ADD COLUMN "notify_in_app" boolean DEFAULT true;`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "profiles" DROP COLUMN "phone_verified";
  ALTER TABLE "profiles" DROP COLUMN "notify_email";
  ALTER TABLE "profiles" DROP COLUMN "notify_in_app";`);
}
