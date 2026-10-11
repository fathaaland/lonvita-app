import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { toE164 } from '@/lib/phone'

/**
 * Profiles store their phone in E.164 from now on (Profiles ensureUniquePhone) — that is what makes
 * "735 929 442" and "+420735929442" the same number when checking it isn't someone else's. The
 * numbers saved before are brought to the same form; one that can't be read stays as it was.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const result = await db.execute(sql`SELECT "id", "phone" FROM "profiles" WHERE "phone" IS NOT NULL AND "phone" <> ''`)
  for (const row of result.rows as { id: number; phone: string }[]) {
    const normalized = toE164(row.phone)
    if (normalized && normalized !== row.phone) {
      await db.execute(sql`UPDATE "profiles" SET "phone" = ${normalized} WHERE "id" = ${row.id}`)
    }
  }
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // The typed formatting isn't kept — E.164 stays.
}
