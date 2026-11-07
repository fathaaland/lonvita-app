// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

import { TEST_REDIS_URL } from './tests/redis'

// Every test file boots Payload, which pushes the schema (ALTER TABLE) and writes test rows — never
// against a database that isn't a local or CI one, whatever DATABASE_URI a .env happens to hold.
const testDatabaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URI || process.env.DATABASE_URI_DATABASE_URL || '').hostname
  } catch {
    return ''
  }
})()
if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(testDatabaseHost) && process.env.ALLOW_REMOTE_TEST_DB !== 'true') {
  throw new Error(
    `Refusing to run tests against the database at "${testDatabaseHost || '(unset)'}" — tests change its schema and write to it. ` +
      'Point DATABASE_URI at a local database (docker compose), or set ALLOW_REMOTE_TEST_DB=true if this one is disposable.',
  )
}

// Hooks under test enqueue real jobs (e-mails, reminders). On the shared Redis DB the local
// worker would pick them up and try to mail the @test.local users — keep them on their own DB.
process.env.REDIS_URL = TEST_REDIS_URL

// The platform team's real alert channels (lib/alerts/ops) — a test creating an event outside an
// obec's radius, or logging a crash on purpose, would otherwise page Discord and the team's inbox.
// Tests of the alerts stub their own.
delete process.env.OPS_DISCORD_WEBHOOK_URL
delete process.env.OPS_ALERT_EMAILS
