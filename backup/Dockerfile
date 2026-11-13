# The nightly database backup — its own Railway cron service ("db-backup"), next to the worker, in the EU.
# It used to run on GitHub Actions; it moved so that no copy of personal data passes through a
# provider Lonvita has no data processing agreement with (GitHub on a free plan has none).
#
# The Postgres image brings pg_dump, and for the Sunday restore test initdb, pg_ctl and pg_restore —
# the major version has to be at least the server's (Neon runs 18).
FROM postgres:18-alpine

RUN apk add --no-cache bash gnupg aws-cli curl jq

COPY --chown=postgres:postgres backup/run.sh /usr/local/bin/lonvita-backup
RUN chmod 0755 /usr/local/bin/lonvita-backup

# Not root: initdb (restore test) refuses to run as root, and nothing here needs it.
USER postgres
WORKDIR /var/lib/postgresql

# The image's entrypoint would start a Postgres server; this container only runs the script and exits.
ENTRYPOINT []
CMD ["/usr/local/bin/lonvita-backup"]
