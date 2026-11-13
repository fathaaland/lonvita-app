import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Consents gets a new type, `age_15_plus` — the "je mi alespoň 15 let" declaration asked on
 * registration and, for a Google sign-up, in onboarding (§ 7 zákona 110/2019 Sb.). Additive only.
 *
 * Data: the register of law (110/2019 Sb.) still said "Doplňte…" — it now says what is there. Only the
 * generated sentence is replaced; anything a superadmin wrote around it stays, and so does the status
 * (review_needed) — a superadmin confirms it.
 */
const OLD = 'Doplňte, jak Lonvita ověřuje věk a souhlasy (Consents).'
const NEW =
  'Věk: při založení účtu (e-mailem i přes Google) povinné čestné prohlášení „Prohlašuji, že je mi alespoň 15 let“, uložené v Consents (typ age_15_plus) s verzí textu a časem. Doklad ani datum narození se kvůli tomu neověřuje (minimalizace údajů). Souhlasy: podmínky a marketing v Consents (platform_terms, marketing), odvolání marketingu se zapisuje do audit logu.'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_consents_type" ADD VALUE 'age_15_plus';`)
  await db.execute(sql`
    UPDATE "legal_requirements"
    SET "implementation" = replace("implementation", ${OLD}, ${NEW}), "updated_at" = now()
    WHERE "code" = '110/2019 Sb.' AND position(${OLD} in "implementation") > 0`)
}

// Refuses (and rolls back) while any age_15_plus declaration exists — those rows are the record of
// who declared what; removing them is a decision for a person, not for a rollback.
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "legal_requirements"
    SET "implementation" = replace("implementation", ${NEW}, ${OLD}), "updated_at" = now()
    WHERE "code" = '110/2019 Sb.' AND position(${NEW} in "implementation") > 0`)
  await db.execute(sql`
   ALTER TABLE "consents" ALTER COLUMN "type" SET DATA TYPE text;
  DROP TYPE "public"."enum_consents_type";
  CREATE TYPE "public"."enum_consents_type" AS ENUM('platform_terms', 'marketing');
  ALTER TABLE "consents" ALTER COLUMN "type" SET DATA TYPE "public"."enum_consents_type" USING "type"::"public"."enum_consents_type";`)
}
