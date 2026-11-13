/**
 * Who stands behind the platform in the two public documents (/zasady-ochrany-osobnich-udaju,
 * /podminky). Fill in the real values — while any still starts with "[DOPLNIT", the pages show a
 * "pracovní znění" notice, so a draft is never mistaken for the final text.
 */
export const LEGAL_ENTITY = {
  /** Provozovatel a správce osobních údajů. */
  name: 'Lonvita platform s.r.o.',
  address: 'Makovského 1558/11, Žďár nad Sázavou 7, 591 01 Žďár nad Sázavou',
  idNumber: '29995001',
  /** The address people write to about their data. */
  privacyEmail: 'info@lonvita.cz',
} as const

export const LEGAL_DOCUMENT_VERSION = '1.1'

export const legalIsDraft = Object.values(LEGAL_ENTITY).some((value) => value.startsWith('[DOPLNIT'))

/**
 * Everyone who receives personal data from the platform to run it (zpracovatelé, GDPR čl. 28) or
 * that the visitor's browser talks to. The list is kept next to the pages that show it, so a new
 * integration is added in one place.
 */
/**
 * `transfer` — the legal ground (GDPR kap. V) for a transfer to the USA, as the provider's own DPA
 * gives it; checked 13. 11. 2026 against the DPAs, not against the official DPF list
 * (dataprivacyframework.gov), which has to be looked up by hand. Present only where data is stored
 * or handled in the USA.
 */
export const PROCESSORS: { name: string; purpose: string; where: string; transfer?: string }[] = [
  { name: 'Vercel Inc.', purpose: 'provoz webové aplikace', where: 'EU (Frankfurt)' },
  { name: 'Railway Corp.', purpose: 'provoz úloh na pozadí (e-maily, SMS, mazání dat)', where: 'EU (Nizozemsko)' },
  { name: 'Upstash, Inc.', purpose: 'fronta úloh — po dobu odeslání drží e-mailové a SMS zprávy včetně adresy a telefonního čísla', where: 'EU (Frankfurt)' },
  { name: 'Neon, Inc.', purpose: 'databáze', where: 'EU (Frankfurt)' },
  { name: 'Cloudflare, Inc.', purpose: 'úložiště fotografií, souborů a neměnné kopie záznamů o činnosti; ochrana formulářů (Turnstile)', where: 'USA / EU' },
  { name: 'Functional Software, Inc. (Sentry)', purpose: 'hlášení chyb aplikace — bez osobních údajů, ty se před odesláním odstraňují', where: 'EU (Německo)' },
  {
    name: 'Resend, Inc.',
    purpose: 'odesílání e-mailů',
    where: 'USA',
    transfer: 'standardní smluvní doložky (součást zpracovatelské smlouvy) a rámec EU–USA pro ochranu osobních údajů',
  },
  { name: 'BulkGate s.r.o.', purpose: 'odesílání SMS (jen při zrušení akce, kde obec SMS zapnula)', where: 'EU' },
  {
    name: 'GitHub, Inc.',
    purpose: 'zálohování databáze — šifrovaná záloha vzniká v jeho automatizovaném prostředí a při zkoušce obnovy se tam dočasně rozbalí',
    where: 'USA',
    transfer: 'rámec EU–USA pro ochranu osobních údajů, případně standardní smluvní doložky',
  },
  {
    name: 'Anthropic, PBC',
    purpose:
      'automatické čtení veřejných textů z webů obcí při návrhu akcí k importu. Údaje uživatelů Lonvity mu nepředáváme; texty obcí ale mohou obsahovat jména či kontakty osob (např. pořadatelů), které do návrhů akcí nepřebíráme',
    where: 'USA',
    transfer: 'standardní smluvní doložky (součást zpracovatelské smlouvy)',
  },
  { name: 'Google Ireland Limited', purpose: 'přihlášení účtem Google (jen když ho zvolíte)', where: 'EU / USA' },
  { name: 'OpenStreetMap Foundation', purpose: 'podkladové mapy a vyhledání adresy — váš prohlížeč jim posílá svou IP adresu', where: 'EU / Velká Británie' },
]
