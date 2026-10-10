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
-- pg_stat_statements shows other roles' query text only to members of pg_read_all_stats.
GRANT pg_read_all_stats TO tramo_ro;

-- Every application schema present when this runs (one per module, plus shared). A schema added
-- later needs this script applied again.
DO $$
DECLARE
  app_schemas text;
BEGIN
  SELECT string_agg(quote_ident(nspname), ', ' ORDER BY nspname) INTO app_schemas
    FROM pg_namespace
   WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema', 'public');
  EXECUTE format('GRANT USAGE ON SCHEMA %s TO tramo_ro', app_schemas);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %s TO tramo_ro', app_schemas);
  -- Tables created later by migrations (run as the owner of this script) are readable too.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA %s GRANT SELECT ON TABLES TO tramo_ro', app_schemas);
  -- Unqualified table names resolve in the module schemas (hypothetical indexes need this).
  EXECUTE format('ALTER ROLE tramo_ro SET search_path = %s, public', app_schemas);
END $$;
