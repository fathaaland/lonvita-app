import { defineRailway, github, preserve, project, service } from 'railway/iac'

/**
 * The worker's Railway services (the one called "lonvita-app" runs worker/, not the web app — that is
 * on Vercel). Two of them, from the same image, split by WORKER_QUEUES (worker/src/runtime/queue-selection):
 *  - lonvita-app: the main queue with its schedules, e-mails and SMS — two replicas, so a crash or a
 *    deploy of one doesn't stop deliveries or the clock;
 *  - lonvita-worker-heavy: imports and export rendering, which hold the event loop for minutes — on
 *    their own, so they can't hold up an e-mail, and with a drain long enough to finish one.
 * Every queue must be consumed by one of them; /api/health reports a queue whose heartbeat is missing. Replaces railway.json, which Railway stops reading on
 * 2026-12-01. Railway doesn't read this file on deploy: a change here goes live only through
 * `railway config plan` → `railway config apply`, run from this repository.
 *
 * A named partial: this file manages the worker services only. The Redis service and its volume are
 * left to the Railway dashboard — an apply from here can't touch them.
 */
export const partial = 'lonvita-app'

const SOURCE = github('fathaaland/lonvita-app', { branch: 'main', checkSuites: true }) // after CI passed
// The repository root is the build context — the worker imports src/ (worker/Dockerfile, .dockerignore).
const BUILD = { builder: 'DOCKERFILE', dockerfilePath: 'worker/Dockerfile' } as const
const REGION = 'europe-west4-drams3a'

/** What the heavy jobs need of the main worker's variables (imports: AI, database, storage, alerts). */
const SHARED_ENV = [
  'ANTHROPIC_API_KEY',
  'DATABASE_URI',
  'GOOGLE_CLIENT_ID',
  'NEXT_PUBLIC_APP_URL',
  'NODE_ENV',
  'OPS_ALERT_EMAILS',
  'OPS_DISCORD_WEBHOOK_URL',
  'PAYLOAD_SECRET',
  'REDIS_URL',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'S3_ACCESS_KEY_ID',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'S3_FORCE_PATH_STYLE',
  'S3_REGION',
  'S3_SECRET_ACCESS_KEY',
  'SENTRY_DSN',
] as const

export default defineRailway(() => {
  const worker = service('lonvita-app', {
    // checkSuites: a push to main deploys only after its GitHub checks (CI) passed.
    source: SOURCE,
    build: BUILD,
    // Two: BullMQ hands each job to one replica, the limiters (e-mail, SMS) hold across both and the
    // schedules are registered by id, so nothing runs twice — while one restarts, the other carries on.
    replicas: { [REGION]: 2 },
    deploy: {
      // worker/src/runtime/health.ts — 200 while every queue worker runs.
      healthcheckPath: '/health',
      healthcheckTimeout: 120,
      // A worker that exits for any reason (even 0) is restarted: nothing else sends e-mails or runs
      // the nightly jobs.
      restartPolicyType: 'ALWAYS',
      // Seconds between SIGTERM and SIGKILL on a redeploy — the worker's own shutdown waits up to 25 s
      // for running jobs (worker/src/runtime/shutdown.ts). Railway's default is 0. E-mails and SMS
      // take seconds; the long jobs are the heavy service's.
      drainingSeconds: 30,
      // Never asleep: nothing else sends e-mails, SMS or runs the nightly jobs, and a sleeping
      // worker (Railway's serverless mode) only wakes on inbound traffic — not on a queue.
      sleepApplication: false,
    },
    // Values stay on Railway; listed so the apply keeps them.
    env: {
      ANTHROPIC_API_KEY: preserve(),
      AUDIT_EXPORT_BUCKET: preserve(),
      AUDIT_EXPORT_LOCK: preserve(),
      BULKGATE_APPLICATION_ID: preserve(),
      BULKGATE_APPLICATION_TOKEN: preserve(),
      BULKGATE_SENDER_ID: preserve(),
      BULKGATE_SENDER_ID_VALUE: preserve(),
      DATABASE_URI: preserve(),
      DATA_RETENTION_MODE: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      NEXT_PUBLIC_APP_URL: preserve(),
      NODE_ENV: preserve(),
      OPS_ALERT_EMAILS: preserve(),
      OPS_DISCORD_WEBHOOK_URL: preserve(),
      PAYLOAD_SECRET: preserve(),
      REDIS_URL: preserve(),
      RESEND_API_KEY: preserve(),
      RESEND_FROM_EMAIL: preserve(),
      RESEND_FROM_NAME: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_FORCE_PATH_STYLE: preserve(),
      S3_REGION: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      SENTRY_DSN: preserve(),
      WORKER_QUEUE_CONCURRENCY: preserve(),
      WORKER_QUEUES: 'main,email,sms',
    },
  })

  const heavy = service('lonvita-worker-heavy', {
    source: SOURCE,
    build: BUILD,
    replicas: { [REGION]: 1 },
    deploy: {
      healthcheckPath: '/health',
      healthcheckTimeout: 120,
      restartPolicyType: 'ALWAYS',
      // An AI import or a long export takes minutes; the worker waits WORKER_SHUTDOWN_TIMEOUT_MS for it
      // (below, a little under this) before it goes, instead of 25 s and a re-run that pays the AI again.
      drainingSeconds: 300,
      sleepApplication: false,
    },
    // The same secrets as the main worker — referenced, so they are set (and rotated) in one place.
    env: {
      ...Object.fromEntries(SHARED_ENV.map((key) => [key, worker.env[key]])),
      WORKER_QUEUES: 'heavy',
      WORKER_SHUTDOWN_TIMEOUT_MS: '290000',
    },
  })

  return project('worthy-youth', { resources: [worker, heavy] })
})
