// Load test for a PREVIEW / STAGING deployment — never run against production.
//
//   k6 run -e BASE_URL=https://<preview>.vercel.app -e SCENARIO=browse loadtest/k6.js
//   k6 run -e BASE_URL=... -e SCENARIO=signup -e EVENT_ID=123 \
//          -e USERS_FILE=loadtest/users.json loadtest/k6.js
//
// SCENARIO: browse (default) | signup | login
//   browse  – PEAK_VUS (default 2000) virtual users reading the event list and counts (cacheable, public).
//   signup  – up to 500 users sign in and register for ONE event (EVENT_ID) in a burst.
//   login   – sign-in only.
// USERS_FILE: JSON array of {"email","password"}, one per virtual user (seeded on the preview
//   branch, with consent already accepted). Sign-in is rate-limited per IP (src/lib/security/
//   rate-limit.ts, 20 / 15 min) — so signup/login need either several source IPs (k6 cloud,
//   multiple runners) or the preview's limit raised for the test; otherwise 429s are expected.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { SharedArray } from 'k6/data'
import { Counter } from 'k6/metrics'

const BASE = __ENV.BASE_URL
if (!BASE) throw new Error('BASE_URL is required')
if (/^https?:\/\/(www\.)?lonvita\.(cz|app)/.test(BASE)) throw new Error('refusing to load-test production')
const EVENT_ID = __ENV.EVENT_ID
const SCENARIO = __ENV.SCENARIO || 'browse'
// Peak of the browse scenario. A single home connection often cannot hold 2000 sockets (connection
// refused is the client's or the platform's edge limit, not the app's) — start lower.
const PEAK_VUS = Number(__ENV.PEAK_VUS || 2000)

const users = new SharedArray('users', () => (__ENV.USERS_FILE ? JSON.parse(open(__ENV.USERS_FILE)) : []))
const rateLimited = new Counter('rate_limited_429')
const registered = new Counter('registrations_created')

const scenarios = {
  browse: {
    browse: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: Math.min(500, PEAK_VUS) },
        { duration: '3m', target: PEAK_VUS },
        { duration: '1m', target: 0 },
      ],
      exec: 'browse',
    },
  },
  signup: {
    signup: {
      executor: 'per-vu-iterations',
      vus: Math.min(500, users.length || 500),
      iterations: 1,
      maxDuration: '5m',
      exec: 'signup',
    },
    watchers: { executor: 'constant-vus', vus: 300, duration: '3m', exec: 'watch' },
  },
  login: {
    login: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '2m', preAllocatedVUs: 100, exec: 'login' },
  },
}

export const options = {
  scenarios: scenarios[SCENARIO],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
}

export function browse() {
  const list = http.get(`${BASE}/`)
  check(list, { 'home 200': (r) => r.status === 200 })
  const counts = http.get(`${BASE}/api/events/registration-counts?event=1&event=2&event=3`)
  check(counts, { 'counts 200': (r) => r.status === 200 })
  sleep(5 + Math.random() * 10)
}

// What an open event page does: the cached counts, every ~10–15 s (see EventDetail).
export function watch() {
  const r = http.get(`${BASE}/api/events/registration-counts?event=${EVENT_ID}`)
  check(r, { 'counts 200': (x) => x.status === 200 })
  sleep(10 + Math.random() * 5)
}

function signIn(user) {
  const res = http.post(`${BASE}/api/users/login`, JSON.stringify({ email: user.email, password: user.password }), {
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.status === 429) rateLimited.add(1)
  check(res, { 'login 200': (r) => r.status === 200 })
  return res.status === 200 ? res.json() : null
}

export function login() {
  if (!users.length) throw new Error('USERS_FILE is required')
  signIn(users[Math.floor(Math.random() * users.length)])
}

export function signup() {
  if (!EVENT_ID || !users.length) throw new Error('EVENT_ID and USERS_FILE are required')
  const user = users[(__VU - 1) % users.length]
  const session = signIn(user)
  if (!session) return
  sleep(Math.random() * 5) // people do not click in the same millisecond
  const res = http.post(
    `${BASE}/api/registrations`,
    JSON.stringify({ event: Number(EVENT_ID), user: session.user.id }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (res.status === 429) rateLimited.add(1)
  // 201 = registered; 4xx "full" is a correct answer once the capacity is gone, not a failure.
  check(res, { 'register 201 or refused': (r) => r.status === 201 || (r.status >= 400 && r.status < 500) })
  if (res.status === 201) registered.add(1)
}
