import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" ADD COLUMN "sizes_avatar_url" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_avatar_width" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_avatar_height" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_avatar_mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_avatar_filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_avatar_filename" varchar;
  ALTER TABLE "profiles" ADD COLUMN "avatar_id" integer;
  ALTER TABLE "auth_identities" ADD COLUMN "avatar_imported_at" timestamp(3) with time zone;
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_id_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "media_sizes_avatar_sizes_avatar_filename_idx" ON "media" USING btree ("sizes_avatar_filename");
  CREATE INDEX "profiles_avatar_idx" ON "profiles" USING btree ("avatar_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "profiles" DROP CONSTRAINT "profiles_avatar_id_media_id_fk";
  
  DROP INDEX "media_sizes_avatar_sizes_avatar_filename_idx";
  DROP INDEX "profiles_avatar_idx";
  ALTER TABLE "media" DROP COLUMN "sizes_avatar_url";
  ALTER TABLE "media" DROP COLUMN "sizes_avatar_width";
  ALTER TABLE "media" DROP COLUMN "sizes_avatar_height";
  ALTER TABLE "media" DROP COLUMN "sizes_avatar_mime_type";
  ALTER TABLE "media" DROP COLUMN "sizes_avatar_filesize";
  ALTER TABLE "media" DROP COLUMN "sizes_avatar_filename";
  ALTER TABLE "profiles" DROP COLUMN "avatar_id";
  ALTER TABLE "auth_identities" DROP COLUMN "avatar_imported_at";`)
}
