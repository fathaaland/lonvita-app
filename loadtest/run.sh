#!/bin/sh
# Runs a k6 scenario against a preview with the settings kept in the environment.
#   VERCEL_BYPASS=<secret> sh loadtest/run.sh <preview url> browse [peak vus]
#   VERCEL_BYPASS=<secret> sh loadtest/run.sh <preview url> signup <event id>
set -eu
BASE="${1:?usage: sh loadtest/run.sh <preview url> browse|signup|login [peak vus | event id]}"
SCENARIO="${2:?scenario}"
ARG="${3:-}"
: "${VERCEL_BYPASS:?VERCEL_BYPASS is not set}"
DIR="$(cd "$(dirname "$0")" && pwd)"

case "$SCENARIO" in
  browse) exec k6 run -e BASE_URL="$BASE" -e VERCEL_BYPASS="$VERCEL_BYPASS" -e SCENARIO=browse -e PEAK_VUS="${ARG:-500}" "$DIR/k6.js" ;;
  signup) exec k6 run -e BASE_URL="$BASE" -e VERCEL_BYPASS="$VERCEL_BYPASS" -e SCENARIO=signup -e EVENT_ID="${ARG:?event id}" -e USERS_FILE="$DIR/users.json" "$DIR/k6.js" ;;
  login)  exec k6 run -e BASE_URL="$BASE" -e VERCEL_BYPASS="$VERCEL_BYPASS" -e SCENARIO=login -e USERS_FILE="$DIR/users.json" "$DIR/k6.js" ;;
  *) echo "unknown scenario: $SCENARIO" >&2; exit 1 ;;
esac
