import { defineRailway, github, preserve, project, service } from 'railway/iac'

/**
 * The worker's Railway service (the Railway service is called "lonvita-app", but it runs worker/,
 * not the web app — that is on Vercel). Replaces railway.json, which Railway stops reading on
 * 2026-12-01. Railway doesn't read this file on deploy: a change here goes live only through
 * `railway config plan` → `railway config apply`, run from this repository.
 *
 * A named partial: this file manages the worker service only. The Redis service and its volume are
 * left to the Railway dashboard — an apply from here can't touch them.
 */
export const partial = 'lonvita-app'

export default defineRailway(() => {
  const worker = service('lonvita-app', {
    // checkSuites: a push to main deploys only after its GitHub checks (CI) passed.
    source: github('fathaaland/lonvita-app', { branch: 'main', checkSuites: true }),
    // The repository root is the build context — the worker imports src/ (worker/Dockerfile, .dockerignore).
    build: { builder: 'DOCKERFILE', dockerfilePath: 'worker/Dockerfile' },
    replicas: { 'europe-west4-drams3a': 1 },
    deploy: {
      // worker/src/runtime/health.ts — 200 while every queue worker runs.
      healthcheckPath: '/health',
      healthcheckTimeout: 120,
      // A worker that exits for any reason (even 0) is restarted: nothing else sends e-mails or runs
      // the nightly jobs.
      restartPolicyType: 'ALWAYS',
      // Seconds between SIGTERM and SIGKILL on a redeploy — the worker's own shutdown waits up to 25 s
      // for running jobs (worker/src/runtime/shutdown.ts). Railway's default is 0.
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
      GOOGLE_CLIENT_SECRET: preserve(),
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
      SEED_SECRET: preserve(),
      SENTRY_DSN: preserve(),
      WORKER_QUEUE_CONCURRENCY: preserve(),
    },
  })

  return project('worthy-youth', { resources: [worker] })
})
