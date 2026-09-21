import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "events" ADD COLUMN "is_hidden" boolean DEFAULT false;`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "events" DROP COLUMN "is_hidden";`);
}
