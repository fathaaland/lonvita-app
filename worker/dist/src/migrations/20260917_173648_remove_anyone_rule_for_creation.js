import { sql } from '@payloadcms/db-postgres';
export async function up({ db, payload, req }) {
    await db.execute(sql `
   ALTER TABLE "municipalities" ALTER COLUMN "rules_for_creation" SET DATA TYPE text;
  ALTER TABLE "municipalities" ALTER COLUMN "rules_for_creation" SET DEFAULT 'approved_organizers'::text;
  UPDATE "municipalities" SET "rules_for_creation" = 'approved_organizers' WHERE "rules_for_creation" = 'anyone';
  DROP TYPE "public"."enum_municipalities_rules_for_creation";
  CREATE TYPE "public"."enum_municipalities_rules_for_creation" AS ENUM('municipality_only', 'approved_organizers');
  ALTER TABLE "municipalities" ALTER COLUMN "rules_for_creation" SET DEFAULT 'approved_organizers'::"public"."enum_municipalities_rules_for_creation";
  ALTER TABLE "municipalities" ALTER COLUMN "rules_for_creation" SET DATA TYPE "public"."enum_municipalities_rules_for_creation" USING "rules_for_creation"::"public"."enum_municipalities_rules_for_creation";`);
}
export async function down({ db, payload, req }) {
    await db.execute(sql `
   ALTER TYPE "public"."enum_municipalities_rules_for_creation" ADD VALUE 'anyone' BEFORE 'approved_organizers';`);
}
