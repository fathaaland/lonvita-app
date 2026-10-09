type EnvVar = {
  key: string
  /** Other names the same value may arrive under (an integration's own variable). */
  aliases?: string[]
  description: string
  required: boolean
}

/** Mirrors .env.example — what the app reads, and whether it can run without it. */
const ENV_VARS: EnvVar[] = [
  { key: 'DATABASE_URI', aliases: ['DATABASE_URI_DATABASE_URL'], description: 'PostgreSQL connection string', required: true },
  { key: 'PAYLOAD_SECRET', description: 'Payload secret — signs every session token', required: true },
  { key: 'NEXT_PUBLIC_APP_URL', description: 'Public app URL (e-mail links, CORS/CSRF, share previews)', required: true },
  { key: 'REDIS_URL', description: 'Valkey/Redis — job queue, rate limiting, live capacity', required: true },
  { key: 'S3_BUCKET', description: 'S3 bucket for photos and exports', required: true },
  { key: 'S3_REGION', description: 'S3 region', required: true },
  { key: 'S3_ACCESS_KEY_ID', description: 'S3 access key ID', required: true },
  { key: 'S3_SECRET_ACCESS_KEY', description: 'S3 secret access key', required: true },
  { key: 'RESEND_API_KEY', description: 'Resend — every e-mail the app sends', required: true },
  { key: 'SEED_SECRET', description: 'Bearer secret of POST /api/seed', required: false },
  { key: 'GOOGLE_CLIENT_ID', description: 'Google sign-in (button hidden without it)', required: false },
  { key: 'GOOGLE_CLIENT_SECRET', description: 'Google sign-in (button hidden without it)', required: false },
  { key: 'BETTERSTACK_SOURCE_TOKEN', description: 'BetterStack log shipping (console only without it)', required: false },
]

export type EnvValidationResult = {
  missing: EnvVar[]
  ok: boolean
}

const isSet = ({ key, aliases = [] }: EnvVar) => [key, ...aliases].some((name) => process.env[name]?.trim())

/** Which variables are missing — reported, not thrown: a half-configured preview should still
 * boot far enough to show what it lacks. */
export const validateEnv = (): EnvValidationResult => {
  const missing = ENV_VARS.filter((envVar) => !isSet(envVar))
  return { missing, ok: missing.every((envVar) => !envVar.required) }
}
