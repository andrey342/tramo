---
name: migration
description: Write and verify a database migration - generate table/column changes from the entities (or start an empty one), check it against the migration rules, then run, revert and run again against the compose Postgres, failing if down does not restore the schema. Use for every schema change.
argument-hint: <module> <verb-noun> [--new]
allowed-tools: Bash(pnpm migration:verify*), Bash(pnpm migration:show*), Bash(docker compose ps*), Read, Edit, Write
---

# Migration

Arguments: `$ARGUMENTS`. Needs the compose Postgres running (`docker compose ps`) and
`DATABASE_URL` in `.env` pointing at it.

1. Create the file:
   - entity changes (new table, new or changed columns):
     `pnpm migration:verify generate <module> <verb-noun>` (e.g. `add-program-price-cap`). It diffs
     the entities against the database and keeps only table and column statements. Entities do not
     model CHECKs, indexes, foreign keys or defaults (they live in migrations only), so the
     generator's proposals to drop them are discarded.
   - anything else (CHECK constraints, indexes, data migrations):
     `pnpm migration:verify new <module> <verb-noun>`.
     The file lands in `src/modules/<module>/infrastructure/persistence/migrations/` named
     `YYYYMMDDHHMM-<verb-noun>.ts`, class timestamp to match. Use `shared` as module for
     `src/shared` tables.
2. Complete it by hand against `.claude/rules/migrations.md`: `NOT NULL` unless absence means
   something, `timestamptz(3)`, `CHECK` for enums, cents `>= 0` and `version > 0`, explicit
   `pk_/fk_/ck_/ux_/ix_<schema>_<table>_<cols>` names, no foreign keys across schemas, and a `down`
   that undoes exactly what `up` did.
3. `pnpm migration:verify check`: lints the pending migrations, then runs, reverts and runs them
   again, diffing `pg_dump --schema-only` after each step. It must end with `OK`.
4. Run `pnpm test:int` for the module's repositories: the test database is built from the same
   migrations.

`pnpm migration:verify lint` checks every migration in the repo (CI runs it). Never edit a
migration that has reached `main`; write a new one.
