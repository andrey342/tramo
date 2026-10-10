-- Read-only role and extensions for query diagnostics (Postgres MCP server, /sql-explain).
-- Runs on first start of a new volume; idempotent, so an existing volume can catch up with:
--   docker compose exec postgres psql -U tramo -d tramo -f /docker-entrypoint-initdb.d/02-diagnostics.sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS hypopg;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tramo_ro') THEN
    -- Local development only; the role cannot write and is not created outside this compose file.
    CREATE ROLE tramo_ro LOGIN PASSWORD 'tramo_ro';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO tramo_ro', current_database());
END $$;

ALTER ROLE tramo_ro SET default_transaction_read_only = on;
ALTER ROLE tramo_ro SET statement_timeout = '30s';
-- Unqualified table names resolve in the module schemas (hypothetical indexes need this).
ALTER ROLE tramo_ro SET search_path = shared, iam, catalog, origination, lending, billing, notifications, reporting, public;
-- pg_stat_statements shows other roles' query text only to members of pg_read_all_stats.
GRANT pg_read_all_stats TO tramo_ro;

GRANT USAGE ON SCHEMA shared, iam, catalog, origination, lending, billing, notifications, reporting
  TO tramo_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA
  shared, iam, catalog, origination, lending, billing, notifications, reporting
  TO tramo_ro;
-- Tables created later by migrations (run as the owner of this script) are readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA
  shared, iam, catalog, origination, lending, billing, notifications, reporting
  GRANT SELECT ON TABLES TO tramo_ro;
