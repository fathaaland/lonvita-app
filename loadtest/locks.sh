#!/bin/sh
# Run in a SECOND terminal while a load test runs: every 2 s, what the database sessions are
# waiting on. Many "Lock" waits with an idle CPU = requests queueing on a row lock.
#   OWNER_DIRECT_URL=<test branch owner string> sh loadtest/locks.sh
set -eu
: "${OWNER_DIRECT_URL:?OWNER_DIRECT_URL is not set}"
while true; do
  date '+--- %H:%M:%S'
  psql "$OWNER_DIRECT_URL" -At -F ' | ' -c "
    select coalesce(wait_event_type,'(running)') || '/' || coalesce(wait_event,'-') as waiting_on,
           state, count(*)
    from pg_stat_activity
    where datname = 'neondb' and pid <> pg_backend_pid() and state <> 'idle'
    group by 1, 2 order by 3 desc limit 6"
  sleep 2
done
