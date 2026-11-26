#!/bin/sh
# Vercel build (vercel.json buildCommand). Migrations run only for the production deployment — or for
# a preview whose database is its own (a Neon branch per preview), marked with MIGRATE_ON_BUILD=true
# in that environment. Otherwise every pull request's preview would migrate whatever DATABASE_URI it
# was given — by default the production database — with code that never reached main.
#
# Production, in this order, each step only once the one before it went through:
#   1. CI passed on this very commit (scripts/wait-for-ci.mjs) — Vercel starts building a push to main
#      at once, alongside CI;
#   2. the app builds — a build that fails leaves the database as it was;
#   3. the migrations — a migration that fails fails the deployment, the previous release stays live.
set -eu

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${MIGRATE_ON_BUILD:-}" = "true" ]; then
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    node scripts/wait-for-ci.mjs
  fi

  # Pages prerendered by the build (the sitemap) read the database as it still is. The seed that every
  # Payload boot runs is left to the deployed app — at build time it would write with the new code
  # into the old schema.
  PAYLOAD_MIGRATING=true pnpm run build

  echo "vercel-build: running migrations (VERCEL_ENV=${VERCEL_ENV:-unset})"
  # Migrations change the schema, which the app's own role (lonvita_app, scripts/neon-roles.sql) may not
  # — they run as the owner, through a direct (not -pooler) connection string when one is given.
  # Prints the shape and warns about a missing pooler or TLS; DB_URL_STRICT=1 turns the warnings into a
  # failed build (before any migration ran). A crash of the script itself never blocks the deploy.
  node scripts/db-url-shape.mjs || [ "${DB_URL_STRICT:-}" != "1" ]
  DATABASE_URI="${DATABASE_URI_MIGRATE:-$DATABASE_URI}" pnpm payload migrate
else
  echo "vercel-build: skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset}, MIGRATE_ON_BUILD not set)"
  pnpm run build
fi
