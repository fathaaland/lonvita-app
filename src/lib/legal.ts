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
export const PROCESSORS: { name: string; purpose: string; where: string }[] = [
  { name: 'Vercel Inc.', purpose: 'provoz webové aplikace', where: 'EU (Frankfurt)' },
  { name: 'Railway Corp.', purpose: 'provoz úloh na pozadí (e-maily, SMS, mazání dat) a fronty úloh', where: 'EU (Nizozemsko)' },
  { name: 'Neon, Inc.', purpose: 'databáze', where: 'EU (Frankfurt)' },
  { name: 'Cloudflare, Inc.', purpose: 'úložiště fotografií, souborů a neměnné kopie záznamů o činnosti; ochrana formulářů (Turnstile)', where: 'USA / EU' },
  { name: 'Functional Software, Inc. (Sentry)', purpose: 'hlášení chyb aplikace — bez osobních údajů, ty se před odesláním odstraňují', where: 'EU (Německo)' },
  { name: 'Resend, Inc.', purpose: 'odesílání e-mailů', where: 'USA' },
  { name: 'BulkGate s.r.o.', purpose: 'odesílání SMS (jen při zrušení akce, kde obec SMS zapnula)', where: 'EU' },
  { name: 'GitHub, Inc.', purpose: 'zálohování databáze — záloha prochází jeho automatizovaným prostředím, než se uloží do šifrovaného úložiště', where: 'USA' },
  { name: 'Anthropic, PBC', purpose: 'automatické čtení textů z webů obcí při návrhu akcí k importu (zpracovává veřejné texty, ne údaje uživatelů)', where: 'USA' },
  { name: 'Google Ireland Limited', purpose: 'přihlášení účtem Google (jen když ho zvolíte)', where: 'EU / USA' },
  { name: 'OpenStreetMap Foundation', purpose: 'podkladové mapy a vyhledání adresy — váš prohlížeč jim posílá svou IP adresu', where: 'EU / Velká Británie' },
]
