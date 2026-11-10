-- Database roles for Neon: the app and the backup get less than the owner has.
--
-- Why: today the web app, the worker, the migrations and the backup all connect as the database
-- owner (neondb_owner). Anyone who gets that one connection string — from Vercel, Railway or the CI
-- secrets — can drop the append-only triggers on audit_log and security_events (20261011_200000,
-- 20261110_120000), then change or delete the trail. With these roles the app can read and write rows
-- but cannot change the schema or drop a trigger; only the owner can, and the owner's string is
-- used only to run migrations.
--
--   lonvita_app     the web app (Vercel) and the worker (Railway): rows, never the schema
--   lonvita_backup  the nightly dump (.github/workflows/backup.yml): read-only
--   neondb_owner    migrations only (DATABASE_URI_MIGRATE at the Vercel build) — and you
--
-- Run as the owner, with psql, against a Neon BRANCH of production first (a copy), point a preview at
-- it and click through the app; only then against production. The passwords stay out of this file:
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 \
--     -v app_password="$(openssl rand -base64 36 | tr -d '/+=')" \
--     -v backup_password="$(openssl rand -base64 36 | tr -d '/+=')" \
--     -f scripts/neon-roles.sql
--
-- Then build the two connection strings (the same host and database as the owner's, the new user and
-- password): the app's on the "-pooler" host, the backup's on the direct one. Keep the passwords —
-- the script does not print them.
--
-- Safe to run again (it changes the passwords and grants what is missing).

\set ON_ERROR_STOP on

-- Roles ---------------------------------------------------------------------------------------------
SELECT format('CREATE ROLE lonvita_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lonvita_app') \gexec
SELECT format('ALTER ROLE lonvita_app WITH LOGIN PASSWORD %L', :'app_password') \gexec

SELECT format('CREATE ROLE lonvita_backup LOGIN PASSWORD %L', :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lonvita_backup') \gexec
SELECT format('ALTER ROLE lonvita_backup WITH LOGIN PASSWORD %L', :'backup_password') \gexec

-- Neither may create objects, anywhere.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM lonvita_app, lonvita_backup;
SELECT format('REVOKE ALL ON DATABASE %I FROM lonvita_app, lonvita_backup', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO lonvita_app, lonvita_backup', current_database()) \gexec

-- The app: rows of every table, the sequences behind the ids -----------------------------------------
GRANT USAGE ON SCHEMA public TO lonvita_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lonvita_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lonvita_app;

-- The tables the migrations create from now on come with the same rights. (They are created by the
-- owner — this is the role the default applies to.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lonvita_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lonvita_app;

-- The trail: no UPDATE and no TRUNCATE for the app at all. DELETE stays — the data-retention job
-- removes old rows, and the triggers refuse anything younger than 18 / 12 months. (The triggers are
-- the rule; this is the second lock if one is ever dropped by mistake.)
REVOKE UPDATE, TRUNCATE ON audit_log, security_events FROM lonvita_app;
-- audit_log's one allowed UPDATE is nulling actor/obec when a user or obec is deleted — that is a
-- foreign key action (ON DELETE SET NULL) and runs with the table owner's rights, not the app's.

-- The backup: read everything, change nothing --------------------------------------------------------
GRANT pg_read_all_data TO lonvita_backup;

-- Check ----------------------------------------------------------------------------------------------
SELECT r.rolname,
       r.rolcreatedb, r.rolcreaterole, r.rolsuper,
       has_table_privilege(r.rolname, 'audit_log', 'UPDATE')          AS can_update_audit_log,
       has_table_privilege(r.rolname, 'security_events', 'TRUNCATE')  AS can_truncate_security_events,
       has_table_privilege(r.rolname, 'users', 'INSERT')              AS can_insert_users,
       has_schema_privilege(r.rolname, 'public', 'CREATE')            AS can_create_in_public
FROM pg_roles r
WHERE r.rolname IN ('lonvita_app', 'lonvita_backup')
ORDER BY r.rolname;
-- Expected: lonvita_app  — all false except can_insert_users = true;
--           lonvita_backup — all false.
