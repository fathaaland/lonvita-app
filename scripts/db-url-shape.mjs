// Prints the shape of the database URLs the build sees — never the password. For a build that fails
// with "ENOTFOUND base" (pg-connection-string reads an empty or malformed URL as host "base").
// Besides the shape, it checks what a serverless deployment depends on and nothing else enforces:
//   - the app's DATABASE_URI goes through Neon's pooler ("-pooler" in the host) — every Vercel instance
//     opens its own connections, and without PgBouncer in front a traffic peak exhausts Postgres;
//   - DATABASE_URI_MIGRATE does not (migrations need a direct connection);
//   - a remote database is reached over TLS (sslmode=require or stronger).
// Problems are printed as warnings; with DB_URL_STRICT=1 they fail the build.
const problems = []

for (const name of ['DATABASE_URI_MIGRATE', 'DATABASE_URI']) {
  const value = process.env[name]
  if (value === undefined) {
    console.log(`db-url-shape: ${name} is not set`)
    continue
  }
  const shape = {
    length: value.length,
    startsWithScheme: /^postgres(ql)?:\/\//.test(value),
    hasOuterWhitespace: value !== value.trim(),
    hasNewline: /[\r\n]/.test(value),
    hasQuoteOrBracket: /["'<>]/.test(value),
  }
  try {
    const url = new URL(value)
    shape.protocol = url.protocol
    shape.user = url.username
    shape.host = url.hostname
    shape.database = url.pathname
    shape.passwordLength = decodeURIComponent(url.password).length
    const isNeon = url.hostname.endsWith('.neon.tech')
    const isLocal = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/.test(url.hostname)
    const pooled = url.hostname.split('.')[0].endsWith('-pooler')
    if (name === 'DATABASE_URI' && isNeon && !pooled) {
      problems.push(`${name}: Neon host without "-pooler" — serverless instances would connect straight to Postgres`)
    }
    if (name === 'DATABASE_URI_MIGRATE' && isNeon && pooled) {
      problems.push(`${name}: pooled host — migrations need the direct connection (drop "-pooler")`)
    }
    const sslmode = url.searchParams.get('sslmode')
    if (!isLocal && !['require', 'verify-ca', 'verify-full'].includes(sslmode ?? '')) {
      problems.push(`${name}: no sslmode=require (or stronger) on a remote database`)
    }
  } catch {
    shape.parse = 'not a valid URL'
  }
  console.log(`db-url-shape: ${name} ${JSON.stringify(shape)}`)
}

for (const problem of problems) console.log(`db-url-shape: WARNING ${problem}`)
if (problems.length > 0 && process.env.DB_URL_STRICT === '1') process.exit(1)
