// Fails when a migration added or changed in this branch deletes data in its up() — DROP TABLE,
// DROP COLUMN, DROP SCHEMA, TRUNCATE, DELETE FROM — unless the pull request carries the label
// `destructive-ok` (CI passes it as DESTRUCTIVE_OK=1).
//
// Why: migrations run on the production database as part of the deploy, and a dropped column or table
// cannot be taken back by rolling the code back. The rule behind it is two steps — first a release
// that stops using the column (the app no longer reads or writes it), and only the next release drops
// it — so the label is a person saying "the code no longer touches this, I checked".
//
// Only up() is read: down() of a harmless migration drops what up() created.
//
// Usage: node scripts/check-destructive-migrations.mjs <base-ref>   (CI: the PR's base branch, fetched)
//        node scripts/check-destructive-migrations.mjs --files a.ts b.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+SCHEMA|TRUNCATE|DELETE\s+FROM)\b/gi

const args = process.argv.slice(2)
let files
if (args[0] === '--files') {
  files = args.slice(1)
} else if (args[0]) {
  const out = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=AM', `origin/${args[0]}`, 'HEAD', '--', 'src/migrations'],
    { encoding: 'utf8' },
  )
  files = out.split('\n').filter(Boolean)
} else {
  console.error('usage: check-destructive-migrations.mjs <base-branch> | --files <file...>')
  process.exit(2)
}
files = files.filter((file) => file.endsWith('.ts') && !file.endsWith('index.ts'))

const findings = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const upStart = source.search(/export\s+async\s+function\s+up\b/)
  if (upStart === -1) continue
  const downStart = source.search(/export\s+async\s+function\s+down\b/)
  const up = source.slice(upStart, downStart > upStart ? downStart : undefined)
  const lines = up.split('\n')
  lines.forEach((line, index) => {
    if (/^\s*(--|\/\/)/.test(line)) return
    for (const match of line.matchAll(DESTRUCTIVE)) {
      findings.push(`${file}: up() has "${match[1].replace(/\s+/g, ' ').toUpperCase()}" (line ${index + 1} of up)`)
    }
  })
}

if (findings.length === 0) {
  console.log(`check-destructive-migrations: ${files.length} changed migration(s), nothing destructive in up()`)
  process.exit(0)
}

if (process.env.DESTRUCTIVE_OK === '1') {
  console.log('check-destructive-migrations: destructive statements allowed by the `destructive-ok` label:')
  for (const finding of findings) console.log(`  ${finding}`)
  process.exit(0)
}

console.error('::error::A migration deletes data. Confirm the code no longer uses it, then add the label `destructive-ok` to the pull request.')
for (const finding of findings) console.error(`  ${finding}`)
process.exit(1)
