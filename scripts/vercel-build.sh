#!/bin/sh
# Vercel build (vercel.json buildCommand). Migrations run only for the production deployment — or for
# a preview whose database is its own (a Neon branch per preview), marked with MIGRATE_ON_BUILD=true
# in that environment. Otherwise every pull request's preview would migrate whatever DATABASE_URI it
# was given — by default the production database — with code that never reached main.
set -eu

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${MIGRATE_ON_BUILD:-}" = "true" ]; then
  echo "vercel-build: running migrations (VERCEL_ENV=${VERCEL_ENV:-unset})"
  pnpm payload migrate
else
  echo "vercel-build: skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset}, MIGRATE_ON_BUILD not set)"
fi

pnpm run build
