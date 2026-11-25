// Refuses to run a command that writes to a database unless that database is local — or the caller
// said so with ALLOW_PROD=1. Wired in front of `pnpm migrate`, `pnpm migrate:create` and `pnpm db:seed`
// (package.json), because a `vercel env pull` file (.env.production.local) or a pasted shell variable
// points them at production without anything on screen saying so.
//
// Not wired into CI or the Vercel build: they call `payload migrate` directly, on purpose.
import { config } from 'dotenv'

// The same files, in the same order, that Next/Payload read (the first one to define a variable wins;
// dotenv never overrides what the shell already set).
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
for (const file of [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']) {
  config({ path: file, quiet: true })
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|host\.docker\.internal)$|\.(local|localhost)$/

const remote = []
for (const name of ['DATABASE_URI', 'DATABASE_URI_MIGRATE', 'DATABASE_URL']) {
  const value = process.env[name]
  if (!value) continue
  let host
  try {
    host = new URL(value).hostname
  } catch {
    remote.push(`${name} (not a valid URL)`)
    continue
  }
  if (!LOCAL_HOST.test(host)) remote.push(`${name} -> ${host}`)
}

if (remote.length === 0) process.exit(0)

if (process.env.ALLOW_PROD === '1') {
  console.warn(`guard-prod-db: ALLOW_PROD=1 — continuing against a non-local database: ${remote.join(', ')}`)
  process.exit(0)
}

console.error(
  [
    'guard-prod-db: refusing to run — the database is not local:',
    ...remote.map((entry) => `  ${entry}`),
    '',
    'This looks like a production or shared database. Use the local one (docker-compose.yml), or, if',
    'you really mean it, repeat the command with ALLOW_PROD=1 in front of it.',
  ].join('\n'),
)
process.exit(1)
