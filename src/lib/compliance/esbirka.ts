/**
 * Reading a regulation's versions from e-Sbírka (the official Sbírka zákonů) — what tells the
 * platform a law in its register (LegalRequirements) changed, or will: a new version in force, or
 * an amendment published and coming into force later.
 *
 * GET {base}/dokumenty-sbirky/{staleUrl}/historie (the versions) and …/souvislosti (amending and
 * repealing acts), staleUrl "/sb/{rok}/{cislo}" URL-encoded whole.
 * Read from the portal's own public cache (e-sbirka.gov.cz/sbr-cache), no key — a few requests a
 * night, one at a time.
 */

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

async function getJson(code: string, suffix: string, fetchImpl: typeof fetch): Promise<unknown> {
  const staleUrl = staleUrlOf(code)
  if (!staleUrl) {
    throw new EsbirkaError(
      `„${code}“ není předpis Sbírky zákonů — v e-Sbírce ho hlídat nejde.`,
      false,
    )
  }
  const url = `${PUBLIC_BASE}/dokumenty-sbirky/${encodeURIComponent(staleUrl)}/${suffix}`

  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new EsbirkaError('e-Sbírka neodpověděla.', true)
  }
  if (res.status === 404) throw new EsbirkaError(`Předpis ${code} v e-Sbírce není.`, false)
  if (!res.ok) {
    throw new EsbirkaError(
      `e-Sbírka vrátila chybu ${res.status}.`,
      res.status === 429 || res.status >= 500,
    )
  }
  return res.json().catch(() => null)
}

export async function fetchVersions(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EsbirkaVersion[]> {
  const body = (await getJson(code, 'historie', fetchImpl)) as HistoryResponse | null
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

/**
 * The regulation's links to others (the portal's "Souvislosti" card): which acts amend it and which
 * repealed it. An amendment shows up here the day it's published — the consolidated versions
 * (historie) follow only once the editors work it in, weeks later, so watching versions alone would
 * miss a novela until then.
 */
export type EsbirkaRelations = { amendedBy: string[]; repealedBy: string[] }

type RelationsResponse = {
  souvislosti?: { typ?: string; dokumentySbirky?: { kodDokumentuSbirky?: string }[] }[]
}

export async function fetchRelations(code: string, fetchImpl: typeof fetch = fetch): Promise<EsbirkaRelations> {
  const body = (await getJson(code, 'souvislosti', fetchImpl)) as RelationsResponse | null
  if (!body || !Array.isArray(body.souvislosti)) {
    throw new EsbirkaError('e-Sbírka vrátila nečekanou odpověď (souvislosti).', false)
  }
  const codesOf = (type: string) =>
    body
      .souvislosti!.filter((group) => group.typ === type)
      .flatMap((group) => group.dokumentySbirky ?? [])
      .map((doc) => doc.kodDokumentuSbirky)
      .filter((c): c is string => Boolean(c))
  return { amendedBy: codesOf('JE_MENEN'), repealedBy: codesOf('JE_RUSEN') }
}

const watched = (v: EsbirkaVersion) => v.type === 'AKTUALNI' || v.type === 'BUDOUCI'

/**
 * What matters of a regulation: the version in force and every one coming, the acts amending it and
 * the one repealing it — sorted, so the same state always gives the same fingerprint. Prefixed with
 * its format: a fingerprint of the older, versions-only format is re-learnt once, not reported as a
 * change of every regulation the night this shipped.
 */
const FINGERPRINT_V2 = 'v2'

export const fingerprintOf = (versions: EsbirkaVersion[], relations?: EsbirkaRelations): string => {
  const parts = versions.filter(watched).map((v) => v.staleUrl)
  if (!relations) return parts.sort().join('|')
  parts.push(...relations.amendedBy.map((c) => `novela:${c}`), ...relations.repealedBy.map((c) => `zrusen:${c}`))
  return [FINGERPRINT_V2, ...parts.sort()].join('|')
}

/** Whether `previous` can be compared with a fingerprint of today's format at all. */
export const isComparableFingerprint = (previous: string): boolean => previous.startsWith(`${FINGERPRINT_V2}|`)

const czDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })
    : '?'

/** What's new against the state known before — in words, for the register and the notification. */
export function describeChange(previous: string, versions: EsbirkaVersion[], relations?: EsbirkaRelations): string {
  const known = new Set(previous.split('|').filter(Boolean))
  const lines: string[] = []

  for (const code of relations?.repealedBy ?? []) {
    if (!known.has(`zrusen:${code}`)) lines.push(`Předpis byl zrušen předpisem ${code.replace(/\.$/, '')}.`)
  }
  // A novela already worked into a new version is told about there, with its effective date.
  const inVersions = new Set(versions.filter(watched).flatMap((v) => v.amendments))
  for (const code of relations?.amendedBy ?? []) {
    if (!known.has(`novela:${code}`) && !inVersions.has(code)) {
      lines.push(`Vyhlášena novela ${code} (do znění zatím nezapracovaná — účinnost viz e-Sbírka).`)
    }
  }
  for (const v of versions.filter((v) => watched(v) && !known.has(v.staleUrl))) {
    const amendments = v.amendments.length > 0 ? ` (novely: ${v.amendments.join(', ')})` : ''
    lines.push(
      v.type === 'BUDOUCI'
        ? `Vyhlášena změna účinná od ${czDate(v.effectiveFrom)}${amendments}.`
        : `Nové znění účinné od ${czDate(v.effectiveFrom)}${amendments}.`,
    )
  }
  return lines.length > 0
    ? lines.join(' ')
    : 'Změnil se seznam platných znění (některé připravované znění bylo zrušeno nebo upraveno).'
}

/** The regulation on the public portal — where a person reads what changed. */
export const esbirkaPortalUrl = (code: string): string | null => {
  const staleUrl = staleUrlOf(code)
  return staleUrl ? `https://e-sbirka.gov.cz${staleUrl}` : null
}
