#!/bin/sh
# Quick check of a preview before a load test: the bypass works, and the login limit is lifted.
#   VERCEL_BYPASS=<secret> sh loadtest/check.sh https://<preview>.vercel.app
set -eu
BASE="${1:?usage: sh loadtest/check.sh <preview url>}"
: "${VERCEL_BYPASS:?VERCEL_BYPASS is not set}"

home=$(curl -s -o /dev/null -w '%{http_code}' -H "x-vercel-protection-bypass: $VERCEL_BYPASS" "$BASE/")
echo "home:  $home   (200 = the bypass works; 302 = it does not)"

# 25 wrong logins: over the normal limit of 20 per 15 minutes, far under the raised one.
last=""
for i in $(seq 1 25); do
  last=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "x-vercel-protection-bypass: $VERCEL_BYPASS" -H 'Content-Type: application/json' \
    -d '{"email":"nobody@example.invalid","password":"x"}' "$BASE/api/users/login")
done
echo "login: $last   (401/400/403 = the limit is lifted; 429 = RATE_LIMIT_MULTIPLIER is not in this build)"
