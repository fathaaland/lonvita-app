/**
 * Seeds the data the k6 sign-up scenario needs — on a Neon BRANCH, never on production:
 * one obec, one organizer, ONE open event (auto-approval, a set capacity) and N test users with the
 * platform terms accepted. Writes loadtest/users.json for k6 (gitignored: it holds a password).
 *
 *   DATABASE_URI=<branch owner string, direct> pnpm tsx scripts/loadtest-seed.ts --users 500 --capacity 200
 *   DATABASE_URI=<same> pnpm tsx scripts/loadtest-seed.ts --cleanup
 *
 * It refuses to run unless LOADTEST_ALLOW_HOST names the database host (so a connection string
 * pasted from the wrong place stops here), and always when the host is listed in LOADTEST_DENY_HOST.
 * Run it with the OWNER string: the app's own role is for rows, and this only writes rows too, but
 * the owner is what the branch has at hand.
 */
import 'dotenv/config'

import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

import { getPayload } from 'payload'

import config from '../src/payload.config'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const uri = process.env.DATABASE_URI ?? ''
const host = (() => {
  try {
    return new URL(uri).hostname
  } catch {
    return ''
  }
})()
const allowed = process.env.LOADTEST_ALLOW_HOST
if (!host || !allowed || host !== allowed) {
  console.error(`Refusing to run: set LOADTEST_ALLOW_HOST to the exact host of the TEST branch (got "${host}").`)
  process.exit(1)
}
if (process.env.LOADTEST_DENY_HOST && host === process.env.LOADTEST_DENY_HOST) {
  console.error('Refusing to run: this is the production host.')
  process.exit(1)
}

const TAG = 'loadtest'
const DAY = 24 * 60 * 60 * 1000

// Building a Payload instance runs the app's own onInit, which seeds demo accounts anywhere that is
// not NODE_ENV=production — into a copy of real data, that is noise at best. PAYLOAD_MIGRATING is the
// switch the worker and `payload migrate` use to skip it (payload.config.ts).
process.env.PAYLOAD_MIGRATING = 'true'

const payload = await getPayload({ config })

if (process.argv.includes('--cleanup')) {
  const users = await payload.find({
    collection: 'users',
    where: { email: { like: `${TAG}+%@example.invalid` } },
    limit: 0,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  for (const user of users.docs) {
    await payload.delete({ collection: 'registrations', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'consents', where: { user: { equals: user.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch((e) => console.error(String(e)))
  }
  console.log(`Removed ${users.docs.length} test users (the test event and obec stay — delete them in the admin or drop the branch).`)
  process.exit(0)
}

const count = Number(arg('users', '500'))
const capacity = Number(arg('capacity', '200'))
const password = randomBytes(18).toString('base64url')

const municipality = await payload.create({
  collection: 'municipalities',
  data: { name: `Loadtest obec ${Date.now()}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
  overrideAccess: true,
})
const category = await payload.create({ collection: 'event-categories', data: { name: `Loadtest ${Date.now()}` }, overrideAccess: true })
const organizer = await payload.create({
  collection: 'users',
  data: { email: `${TAG}+organizer@example.invalid`, password, role: 'user' },
  overrideAccess: true,
})
await payload.create({
  collection: 'user-roles',
  data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
  overrideAccess: true,
})
const event = await payload.create({
  collection: 'events',
  data: {
    title: `Loadtest akce ${new Date().toISOString()}`,
    dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
    locationText: 'Náves',
    lat: 49.5661,
    lng: 15.9403,
    capacity,
    organizer: organizer.id,
    municipality: municipality.id,
    categories: [category.id],
    status: 'active',
    isPaid: false,
    registrationApprovalMode: 'auto',
  },
  // No e-mail or SMS for anyone — this is a test.
  context: { skipNotifications: true },
  overrideAccess: true,
})

const users: { email: string; password: string }[] = []
for (let i = 1; i <= count; i++) {
  const email = `${TAG}+${i}@example.invalid`
  const user = await payload.create({ collection: 'users', data: { email, password, role: 'user' }, overrideAccess: true })
  await payload.create({
    collection: 'consents',
    data: { user: user.id, type: 'platform_terms', version: '1.0', grantedAt: new Date().toISOString() },
    overrideAccess: true,
  })
  users.push({ email, password })
  if (i % 50 === 0) console.log(`${i}/${count} users`)
}

mkdirSync('loadtest', { recursive: true })
writeFileSync('loadtest/users.json', JSON.stringify(users))
console.log(`Event id ${event.id} (capacity ${capacity}), ${count} users → loadtest/users.json`)
console.log(`k6 run -e BASE_URL=<preview> -e SCENARIO=signup -e EVENT_ID=${event.id} -e USERS_FILE=loadtest/users.json loadtest/k6.js`)
process.exit(0)
