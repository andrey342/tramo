#!/usr/bin/env bash
# Generates and verifies migrations against the compose Postgres (DATABASE_URL from .env).
#
#   pnpm migration:verify generate <module> <verb-noun>
#       Diffs the ORM entities against the database and writes the table and column changes as a
#       migration under the module (YYYYMMDDHHMM-<verb-noun>.ts). Constraints, indexes and defaults
#       are not modelled on entities, so they are left out and written by hand.
#   pnpm migration:verify new <module> <verb-noun>
#       Writes an empty migration with the conventional name, for changes entities do not
#       describe (CHECK constraints, indexes, data migrations).
#   pnpm migration:verify check
#       Lints pending migrations against .claude/rules/migrations.md, then runs them, reverts them
#       and runs them again. Fails if `down` does not restore the schema exactly, or if running
#       again does not reproduce it. With nothing pending, it checks the last applied migration.
#   pnpm migration:verify lint
#       Lints every migration in the repo.
set -euo pipefail

cd "$(dirname "$0")/../../../.."
DB_USER="${POSTGRES_USER:-tramo}"
DB_NAME="${POSTGRES_DB:-tramo}"
DATA_SOURCE=dist/src/shared/infrastructure/database/data-source.js
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

typeorm() { pnpm exec typeorm "$@" -d "$DATA_SOURCE"; }

snapshot() {
  # Schema only, without ownership, the migrations bookkeeping table or the random key pg_dump
  # writes on its \restrict lines, so two dumps of the same schema are byte-identical.
  docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --schema-only --no-owner \
    --no-privileges --exclude-table=public.migrations \
    | grep -vE '^(--|SET |SELECT pg_catalog|[\]restrict |[\]unrestrict )' | sed '/^$/d' > "$1"
}

pending_files() {
  typeorm migration:show | sed -nE 's/^ *\[ \] +([A-Za-z0-9]+)$/\1/p'
}

lint_migration() {
  local file="$1" problems=0
  local base
  base="$(basename "$file")"
  if [[ ! "$base" =~ ^[0-9]{12}-[a-z0-9]+(-[a-z0-9]+)+\.ts$ ]]; then
    echo "  $base: name must be YYYYMMDDHHMM-<verb>-<noun>.ts"; problems=1
  fi
  # TypeORM's generated names (PK_..., FK_..., IDX_..., UQ_..., REL_... with a hash).
  if grep -qE '"(PK|FK|IDX|UQ|REL)_[0-9a-f]{10,}"' "$file"; then
    echo "  $base: replace generated constraint/index names with pk_/fk_/ck_/ux_/ix_<schema>_<table>_<cols>"; problems=1
  fi
  if grep -oiE 'CREATE (UNIQUE )?INDEX( CONCURRENTLY)?( IF NOT EXISTS)? "?[a-z0-9_]+' "$file" \
      | grep -viE ' "?(ix|ux)_[a-z0-9_]+$' | grep -q .; then
    echo "  $base: index names start with ix_ (or ux_ for unique indexes)"; problems=1
  fi
  if grep -oiE 'CONSTRAINT "?[a-z0-9_]+' "$file" | grep -viE ' "?(pk|fk|ck|ux|uq)_' | grep -q .; then
    echo "  $base: constraint names start with pk_, fk_, ck_ or ux_"; problems=1
  fi
  if grep -iE '\btimestamp\b' "$file" | grep -viE 'with time zone' | grep -q .; then
    echo "  $base: timestamps are timestamptz(3)"; problems=1
  fi
  if grep -qE 'REFERENCES "?(shared|iam|catalog|origination|lending|billing|notifications|reporting)"?\.' "$file"; then
    local own
    own="$(echo "$file" | sed -nE 's#^src/modules/([a-z-]+)/.*#\1#p' | tr - _)"
    if grep -oE 'REFERENCES "?[a-z_]+"?\.' "$file" | grep -vqE "REFERENCES \"?(${own:-shared})\"?\."; then
      echo "  $base: no foreign keys across schemas (ADR 008)"; problems=1
    fi
  fi
  return $problems
}

case "${1:-}" in
  generate)
    module="${2:?usage: generate <module> <verb-noun>}"
    description="${3:?usage: generate <module> <verb-noun>}"
    pnpm -s build
    # The generator writes <ms>-<name>.ts into a scratch folder; shape-migration.ts keeps the
    # table and column changes and writes the file where it belongs, named by convention.
    status=0
    typeorm migration:generate "$WORK/$description" --pretty || status=$?
    generated="$(ls "$WORK"/*-"$description".ts 2>/dev/null | head -1 || true)"
    if [ -z "$generated" ]; then
      echo "the entities match the database (exit $status); use 'new' to write a migration by hand"
      exit 1
    fi
    pnpm exec tsx .claude/skills/migration/scripts/shape-migration.ts generated "$generated" "$module" "$description"
    echo "review it against .claude/rules/migrations.md (NOT NULL, CHECKs, named indexes), then: pnpm migration:verify check"
    ;;

  new)
    pnpm exec tsx .claude/skills/migration/scripts/shape-migration.ts new "${2:?usage: new <module> <verb-noun>}" "${3:?usage: new <module> <verb-noun>}"
    ;;

  check)
    pnpm -s build
    mapfile -t pending < <(pending_files)
    echo "pending migrations: ${#pending[@]}"
    failed=0
    for name in "${pending[@]}"; do
      file="$(grep -rl "name = '$name'" src --include='*.ts' | head -1)"
      echo "lint $file"
      lint_migration "$file" || failed=1
    done
    [ "$failed" = 0 ] || { echo "fix the problems above first"; exit 1; }

    if [ "${#pending[@]}" -eq 0 ]; then
      echo "nothing pending: checking the last applied migration"
      snapshot "$WORK/after.sql"
      typeorm migration:revert
      snapshot "$WORK/before.sql"
      typeorm migration:run
      snapshot "$WORK/again.sql"
    else
      snapshot "$WORK/before.sql"
      typeorm migration:run
      snapshot "$WORK/after.sql"
      for _ in "${pending[@]}"; do typeorm migration:revert; done
      snapshot "$WORK/reverted.sql"
      if ! diff -u "$WORK/before.sql" "$WORK/reverted.sql"; then
        echo "FAIL: down did not restore the schema (diff above)"; exit 1
      fi
      typeorm migration:run
      snapshot "$WORK/again.sql"
    fi
    if ! diff -u "$WORK/after.sql" "$WORK/again.sql"; then
      echo "FAIL: running the migration again gives a different schema (diff above)"; exit 1
    fi
    echo "OK: up, down and up again leave the schema consistent"
    ;;

  lint)
    failed=0
    while IFS= read -r file; do
      lint_migration "$file" || failed=1
    done < <(find src -path '*/migrations/*.ts' | sort)
    [ "$failed" = 0 ] && echo "OK: migrations follow the naming and type rules"
    exit "$failed"
    ;;

  *)
    awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
    exit 1
    ;;
esac
