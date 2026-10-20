/**
 * Importing events from the calendars obce and organizations already keep on their websites
 * (docs/import-akci-z-webu.md). Whatever the input — a web page, an iCal feed, a pasted program, a
 * PDF of the zpravodaj — it ends up as ExtractedEvents, which become candidates the obec's admin
 * approves (collections EventImportCandidates). Shared by the worker, the API routes and the UI.
 */

/** A calendar day and, when the source says, a time — in Prague, as written on the source. */
export type WallTime = { date: string; time: string | null }

/** One event as the source describes it — nothing checked, geocoded or deduplicated yet. */
export type ExtractedEvent = {
  title: string
  description: string | null
  start: WallTime
  end: WallTime | null
  /** "Sokolovna", "Náměstí Republiky" — the place as written. */
  locationName: string | null
  /** Street address, when the source gives one. */
  address: string | null
  /** Coordinates the source itself carries (iCal GEO, schema.org geo). */
  lat?: number | null
  lng?: number | null
  /** The event's own page, absolute. */
  detailUrl: string | null
  /** Names from the platform's category list the extractor matched it to. */
  categoryNames: string[]
  isPaid: boolean | null
  priceCzk: number | null
  /** The source marks it as called off ("ZRUŠENO"). */
  cancelled: boolean
  /** The source's own stable id (iCal UID + occurrence). */
  externalId: string | null
}

/** Why a candidate isn't ready to approve as it is — or something the admin should look at. */
export const IMPORT_WARNINGS = {
  location_missing: 'Místo konání chybí — doplňte ho na mapě.',
  location_not_found: 'Místo se nepodařilo najít na mapě — doplňte ho.',
  outside_radius: 'Nalezené místo leží mimo okruh obce — zkontrolujte ho.',
  time_missing: 'Zdroj neuvádí čas začátku — doplňte ho.',
  no_category: 'Nepodařilo se určit kategorii — vyberte ji.',
  possible_duplicate: 'V Lonvitě už je podobná akce ve stejný den.',
  cancelled_at_source: 'Zdroj akci uvádí jako zrušenou.',
} as const

export type ImportWarning = keyof typeof IMPORT_WARNINGS

/** Every warning holds a candidate back from approval without opening it — each one is something
 * the admin has to fill in or look at first. */
export const isReadyToApprove = (warnings: readonly string[] | null | undefined): boolean =>
  (warnings ?? []).length === 0

/** Where a candidate came from. */
export type ImportOrigin = 'source' | 'text' | 'file'

/** What the worker is asked to read: a saved source, a pasted program or an uploaded file. */
export type ImportInput =
  | { kind: 'source'; sourceId: number | string }
  | { kind: 'text'; municipalityId: number | string; requestedBy: number | string; text: string }
  | {
      kind: 'file'
      municipalityId: number | string
      requestedBy: number | string
      fileKey: string
      fileName: string
      mimeType: string
    }

export const IMPORT_LIMITS = {
  /** Sources one obec may keep. */
  sourcesPerMunicipality: 10,
  /** A pasted program. */
  textMaxChars: 50_000,
  /** An uploaded file — under Vercel's 4.5 MB request body limit. */
  fileMaxBytes: 4 * 1024 * 1024,
  /** What a fetched page may weigh. */
  fetchMaxBytes: 5 * 1024 * 1024,
  /** The text of a page handed to the AI. */
  aiTextMaxChars: 150_000,
  /** New candidates one run may add. */
  candidatesPerRun: 200,
  /** Detail pages one run may open to complete what the list page doesn't say. */
  detailPagesPerRun: 10,
  /** How far ahead a recurring schedule is spelled out into single dates. */
  recurrenceDaysAhead: 60,
  /** How far ahead events are taken at all. */
  horizonDays: 365,
} as const

export const IMPORT_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number]

export const isImportFileType = (value: unknown): value is ImportFileType =>
  IMPORT_FILE_TYPES.includes(value as ImportFileType)

/** How often the worker goes through every enabled source. */
export const SOURCE_SCAN_INTERVAL_HOURS = 6

/** The User-Agent the worker fetches with — names us and where to find out who we are. */
export const IMPORT_USER_AGENT = 'LonvitaBot/1.0 (+https://lonvita.cz; import kalendáře akcí obce)'

/** The robots.txt token we answer to, besides "*". */
export const IMPORT_ROBOTS_TOKEN = 'lonvitabot'
