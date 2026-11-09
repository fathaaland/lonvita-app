import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Data only. The register of law said the nightly copy is kept by "S3 Object Lock, režim COMPLIANCE"
 * — true on S3/MinIO, not in production, where the audit bucket is on Cloudflare R2 and is kept by
 * the bucket's lock rule (worker export-audit-trail, AUDIT_EXPORT_LOCK=bucket). The sentence now says
 * what is actually there and how it is checked. Only the generated sentence is replaced — anything a
 * superadmin wrote around it stays.
 */
const OLD = 'Každou noc neměnná kopie (S3 Object Lock, režim COMPLIANCE) mimo aplikaci.'
const NEW =
  'Každou noc neměnná kopie mimo aplikaci (Cloudflare R2, pravidlo bucket lock na audit bucketu; na S3/MinIO Object Lock v režimu COMPLIANCE). Každý běh nejdřív ověří, že úložiště zápis opravdu drží (zkušební soubor nejde smazat), jinak nic nezapíše, retence nic nesmaže a přijde kritický alert. Délku zámku na R2 (min. 18 měsíců) je potřeba kontrolovat v Cloudflare — přes S3 API ji ověřit nejde.'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "legal_requirements"
    SET "implementation" = replace("implementation", ${OLD}, ${NEW}), "updated_at" = now()
    WHERE "code" = '409/2025 Sb.' AND position(${OLD} in "implementation") > 0`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "legal_requirements"
    SET "implementation" = replace("implementation", ${NEW}, ${OLD}), "updated_at" = now()
    WHERE "code" = '409/2025 Sb.' AND position(${NEW} in "implementation") > 0`)
}
