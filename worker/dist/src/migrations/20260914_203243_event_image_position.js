import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "events" ADD COLUMN "image_position_x" numeric DEFAULT 50;
  ALTER TABLE "events" ADD COLUMN "image_position_y" numeric DEFAULT 50;`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "events" DROP COLUMN "image_position_x";
  ALTER TABLE "events" DROP COLUMN "image_position_y";`);
}
