import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { licencePeriodOf } from '@/lib/billing/period'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "municipalities" ADD COLUMN "licence_paid_until" timestamp(3) with time zone;
  ALTER TABLE "municipalities" ADD COLUMN "licence_reminder_state" varchar;`)

  // Every obec there is runs to the end of the licence period it is in now — then it needs a payment
  // (renewal) for the next one; until now the year simply turned by itself.
  const now = new Date()
  const { rows } = await db.execute<{ id: number; start: string | null; end: string | null }>(sql`
    SELECT id, licence_period_start AS start, licence_period_end AS "end" FROM "municipalities"`)
  for (const row of rows) {
    const period = licencePeriodOf(
      {
        licencePeriodStart: row.start ? new Date(row.start).toISOString() : null,
        licencePeriodEnd: row.end ? new Date(row.end).toISOString() : null,
      },
      now,
    )
    await db.execute(sql`
      UPDATE "municipalities" SET "licence_paid_until" = ${period.end.toISOString()} WHERE "id" = ${row.id}`)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "municipalities" DROP COLUMN "licence_paid_until";
  ALTER TABLE "municipalities" DROP COLUMN "licence_reminder_state";`)
}
