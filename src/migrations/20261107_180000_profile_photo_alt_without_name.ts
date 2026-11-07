import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Profile photos used to be uploaded with the person's full name as `alt`. Media rows are listable
 * by id (Media readMedia), so that made the photo collection a directory of names. New uploads go
 * with a neutral alt; the ones already stored get the same one. Organization logos keep the
 * organization's name, which is public anyway.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "media" SET "alt" = 'Profilová fotka'
    WHERE "id" IN (SELECT "avatar_id" FROM "profiles" WHERE "avatar_id" IS NOT NULL)
  `)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // The names aren't brought back.
}
