import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'


/**
 * The register starts with the law the code already answers to (lib/retention/policy, AuditLog) —
 * every entry "Ke kontrole": a person confirms it applies and how, then marks it reviewed.
 */
export const DEFAULT_REQUIREMENTS = [
  {
    code: '264/2025 Sb.',
    title: 'Zákon o kybernetické bezpečnosti',
    kind: 'zakon',
    requirement:
      'Určit, zda je Lonvita (nebo obce, kterým ji dodává) poskytovatelem regulované služby a v jakém režimu (vyšší / nižší povinnosti). Podle toho platí vyhláška 409/2025 Sb. nebo 410/2025 Sb.',
    implementation:
      'Aplikace je nastavená podle přísnějšího režimu vyšších povinností (409/2025 Sb.). Zařazení Lonvity má potvrdit právník.',
  },
  {
    code: '409/2025 Sb.',
    title: 'Vyhláška o bezpečnostních opatřeních poskytovatele regulované služby v režimu vyšších povinností',
    kind: 'vyhlaska',
    requirement:
      '§ 22 — logování: přihlášení a odhlášení, privilegované činnosti, správa účtů a oprávnění, přístup k logům, změny nastavení logování; u záznamu čas, kdo, odkud, co a s jakým výsledkem; centrální sběr, ochrana integrity a důvěrnosti; uchování alespoň 18 měsíců.',
    implementation:
      'Audit log (kolekce audit-log) jde jen přidávat — úpravu a smazání mladší 18 měsíců odmítne databáze (trigger audit_log_guard). Každý záznam má čas, kdo, IP, prohlížeč, výsledek a ID požadavku. Čtení audit logu se zapisuje. Každou noc neměnná kopie (S3 Object Lock, režim COMPLIANCE) mimo aplikaci. Lhůty: Compliance → Lhůty uchování (min. 18 měsíců). Prohlížení: Superadmin → Audit log.',
  },
  {
    code: '410/2025 Sb.',
    title: 'Vyhláška o bezpečnostních opatřeních poskytovatele regulované služby v režimu nižších povinností',
    kind: 'vyhlaska',
    requirement: 'Přiměřená bezpečnostní opatření včetně logování podle bezpečnostních potřeb.',
    implementation: 'Plněno nad rámec — aplikace splňuje přísnější vyhlášku 409/2025 Sb.',
  },
  {
    code: '2016/679 (EU)',
    title: 'Obecné nařízení o ochraně osobních údajů (GDPR)',
    kind: 'eu',
    url: 'https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32016R0679',
    esbirkaWatch: false,
    requirement:
      'Čl. 5 — minimalizace a omezení doby uložení; čl. 30 — záznamy o činnostech zpracování; čl. 32 — zabezpečení; čl. 33–34 — ohlášení porušení zabezpečení.',
    implementation:
      'Lhůty uchování a noční mazání (úloha data-retention, každé smazání v audit logu); audit log po 36 měsících zmizí. Anonymizace účtu. Záznamy o činnostech zpracování a postup při incidentu je potřeba vést mimo aplikaci — doplňte.',
  },
  {
    code: '110/2019 Sb.',
    title: 'Zákon o zpracování osobních údajů',
    kind: 'zakon',
    requirement: 'Česká úprava k GDPR (mimo jiné věk pro souhlas se službami informační společnosti — 15 let).',
    implementation: 'Doplňte, jak Lonvita ověřuje věk a souhlasy (Consents).',
  },
  {
    code: '89/2012 Sb.',
    title: 'Občanský zákoník',
    kind: 'zakon',
    requirement: '§ 629 — obecná promlčecí lhůta 3 roky: tak dlouho může být potřeba doložit, co se stalo.',
    implementation: 'Audit log se uchovává 36 měsíců (Compliance → Lhůty uchování).',
  },
] as const

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_legal_requirements_kind" AS ENUM('zakon', 'vyhlaska', 'eu', 'other');
  CREATE TYPE "public"."enum_legal_requirements_status" AS ENUM('ok', 'review_needed', 'changed', 'gap');
  CREATE TABLE "legal_requirements" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"title" varchar NOT NULL,
  	"kind" "enum_legal_requirements_kind" DEFAULT 'zakon' NOT NULL,
  	"url" varchar,
  	"requirement" varchar,
  	"implementation" varchar,
  	"owner_id" integer,
  	"status" "enum_legal_requirements_status" DEFAULT 'review_needed' NOT NULL,
  	"review_interval_months" numeric DEFAULT 12,
  	"last_reviewed_at" timestamp(3) with time zone,
  	"last_reviewed_by_id" integer,
  	"next_review_at" timestamp(3) with time zone,
  	"esbirka_watch" boolean DEFAULT true,
  	"esbirka_fingerprint" varchar,
  	"esbirka_checked_at" timestamp(3) with time zone,
  	"esbirka_changed_at" timestamp(3) with time zone,
  	"esbirka_change_summary" varchar,
  	"esbirka_error" varchar,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "retention_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"audit_log_months" numeric,
  	"audit_export_months" numeric,
  	"security_event_months" numeric,
  	"system_log_days" numeric,
  	"import_run_days" numeric,
  	"notification_days" numeric,
  	"notification_read_days" numeric,
  	"decided_request_days" numeric,
  	"organizer_request_months" numeric,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "legal_requirements_id" integer;
  ALTER TABLE "legal_requirements" ADD CONSTRAINT "legal_requirements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "legal_requirements" ADD CONSTRAINT "legal_requirements_last_reviewed_by_id_users_id_fk" FOREIGN KEY ("last_reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "legal_requirements_code_idx" ON "legal_requirements" USING btree ("code");
  CREATE INDEX "legal_requirements_owner_idx" ON "legal_requirements" USING btree ("owner_id");
  CREATE INDEX "legal_requirements_status_idx" ON "legal_requirements" USING btree ("status");
  CREATE INDEX "legal_requirements_last_reviewed_by_idx" ON "legal_requirements" USING btree ("last_reviewed_by_id");
  CREATE INDEX "legal_requirements_next_review_at_idx" ON "legal_requirements" USING btree ("next_review_at");
  CREATE INDEX "legal_requirements_updated_at_idx" ON "legal_requirements" USING btree ("updated_at");
  CREATE INDEX "legal_requirements_created_at_idx" ON "legal_requirements" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_legal_requirements_fk" FOREIGN KEY ("legal_requirements_id") REFERENCES "public"."legal_requirements"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_legal_requirements_id_idx" ON "payload_locked_documents_rels" USING btree ("legal_requirements_id");`)

  for (const data of DEFAULT_REQUIREMENTS) {
    await payload.create({
      collection: 'legal-requirements',
      data: { status: 'review_needed', reviewIntervalMonths: 12, esbirkaWatch: true, ...data },
      overrideAccess: true,
      req,
    })
  }
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "legal_requirements" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "retention_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "legal_requirements" CASCADE;
  DROP TABLE "retention_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_legal_requirements_fk";
  
  DROP INDEX "payload_locked_documents_rels_legal_requirements_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "legal_requirements_id";
  DROP TYPE "public"."enum_legal_requirements_kind";
  DROP TYPE "public"."enum_legal_requirements_status";`)
}
