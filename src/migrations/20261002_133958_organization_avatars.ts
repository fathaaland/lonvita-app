import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "organizations" ADD COLUMN "avatar_id" integer;
  ALTER TABLE "organizations" ADD COLUMN "avatar_url" varchar;
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_avatar_id_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "organizations_avatar_idx" ON "organizations" USING btree ("avatar_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_avatar_id_media_id_fk";
  
  DROP INDEX "organizations_avatar_idx";
  ALTER TABLE "organizations" DROP COLUMN "avatar_id";
  ALTER TABLE "organizations" DROP COLUMN "avatar_url";`)
}
