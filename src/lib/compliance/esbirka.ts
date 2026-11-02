/**
 * Reading a regulation's versions from e-Sbírka (the official Sbírka zákonů) — what tells the
 * platform a law in its register (LegalRequirements) changed, or will: a new version in force, or
 * an amendment published and coming into force later.
 *
 * GET {base}/dokumenty-sbirky/{staleUrl}/historie, staleUrl "/sb/{rok}/{cislo}" URL-encoded whole.
 * With ESBIRKA_API_KEY set: the official public REST API (api.e-sbirka.gov.cz, header
 * esel-api-access-key — the key is granted by MV ČR on request, see e-sbirka.gov.cz/restful-api).
 * Without it: the portal's own public cache (e-sbirka.gov.cz/sbr-cache), the same data with no key —
 * a few requests a night, one at a time.
 */

const API_BASE = 'https://api.e-sbirka.gov.cz'
const PUBLIC_BASE = 'https://e-sbirka.gov.cz/sbr-cache'
const USER_AGENT = 'Lonvita-compliance-watch/1.0 (+https://lonvita.cz)'
const TIMEOUT_MS = 20_000

export class EsbirkaError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'EsbirkaError'
  }
}

/** "264/2025 Sb." → "/sb/2025/264"; null for what isn't in the Sbírka zákonů (EU law, norms). */
export function staleUrlOf(code: string): string | null {
  const match = code.trim().match(/^(\d+)\s*\/\s*(\d{4})\s*Sb\.?$/i)
  return match ? `/sb/${match[2]}/${match[1]}` : null
}

export type EsbirkaVersion = {
  staleUrl: string
  /** AKTUALNI (in force), BUDOUCI (published, in force later), MINULE, VYHLASENE. */
  type: string
  effectiveFrom: string | null
  amendments: string[]
}

type HistoryResponse = {
  historie?: {
    staleUrl?: string
    typZneni?: string
    datumUcinnostiZneniOd?: string
    novely?: { kodDokumentuSbirky?: string }[]
  }[]
}

export async function fetchVersions(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EsbirkaVersion[]> {
  const staleUrl = staleUrlOf(code)
  if (!staleUrl) {
    throw new EsbirkaError(`„${code}“ není předpis Sbírky zákonů — v e-Sbírce ho hlídat nejde.`, false)
  }
  const key = process.env.ESBIRKA_API_KEY?.trim()
  const base = key ? API_BASE : PUBLIC_BASE
  const url = `${base}/dokumenty-sbirky/${encodeURIComponent(staleUrl)}/historie`

  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(key ? { 'esel-api-access-key': key } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new EsbirkaError('e-Sbírka neodpověděla.', true)
  }
  if (res.status === 404) throw new EsbirkaError(`Předpis ${code} v e-Sbírce není.`, false)
  if (res.status === 401) throw new EsbirkaError('e-Sbírka odmítla API klíč (ESBIRKA_API_KEY).', false)
  if (!res.ok) {
    throw new EsbirkaError(`e-Sbírka vrátila chybu ${res.status}.`, res.status === 429 || res.status >= 500)
  }

  const body = (await res.json().catch(() => null)) as HistoryResponse | null
  if (!body || !Array.isArray(body.historie)) {
    throw new EsbirkaError('e-Sbírka vrátila nečekanou odpověď.', false)
  }
  return body.historie
    .filter((v): v is typeof v & { staleUrl: string } => typeof v.staleUrl === 'string')
    .map((v) => ({
      staleUrl: v.staleUrl,
      type: v.typZneni ?? '',
      effectiveFrom: v.datumUcinnostiZneniOd ?? null,
      amendments: (v.novely ?? [])
        .map((n) => n.kodDokumentuSbirky)
        .filter((c): c is string => Boolean(c)),
    }))
}

const watched = (v: EsbirkaVersion) => v.type === 'AKTUALNI' || v.type === 'BUDOUCI'

/** What matters of the versions: the one in force and every one coming — sorted, so the same set
 * always gives the same fingerprint. */
export const fingerprintOf = (versions: EsbirkaVersion[]): string =>
  versions
    .filter(watched)
    .map((v) => v.staleUrl)
    .sort()
    .join('|')

const czDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }) : '?'

/** What's new against the versions known before — in words, for the register and the notification. */
export function describeChange(previous: string, versions: EsbirkaVersion[]): string {
  const known = new Set(previous.split('|').filter(Boolean))
  const fresh = versions.filter((v) => watched(v) && !known.has(v.staleUrl))
  if (fresh.length === 0) {
    return 'Změnil se seznam platných znění (některé připravované znění bylo zrušeno nebo upraveno).'
  }
  return fresh
    .map((v) => {
      const amendments = v.amendments.length > 0 ? ` (novely: ${v.amendments.join(', ')})` : ''
      return v.type === 'BUDOUCI'
        ? `Vyhlášena změna účinná od ${czDate(v.effectiveFrom)}${amendments}.`
        : `Nové znění účinné od ${czDate(v.effectiveFrom)}${amendments}.`
    })
    .join(' ')
}

/** The regulation on the public portal — where a person reads what changed. */
export const esbirkaPortalUrl = (code: string): string | null => {
  const staleUrl = staleUrlOf(code)
  return staleUrl ? `https://e-sbirka.gov.cz${staleUrl}` : null
}
