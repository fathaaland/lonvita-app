import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "municipalities" ADD COLUMN "event_radius_km" numeric DEFAULT 15 NOT NULL;`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "municipalities" DROP COLUMN "event_radius_km";`);
}
