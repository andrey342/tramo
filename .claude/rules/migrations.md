---
paths:
  - '**/migrations/**'
---

# Migrations

- File name `YYYYMMDDHHMM-<verb>-<noun>.ts` (`202610092200-create-iam-api-keys.ts`); class name in
  PascalCase followed by a 13-digit millisecond timestamp, and `name` equal to the class name.
- Raw SQL through `queryRunner.query`, schema-qualified (`iam.users`). One module per migration.
- Columns are `NOT NULL` unless absence is meaningful. Timestamps are `timestamptz(3)` (millisecond
  precision keeps cursors and JS dates equal).
- Every constraint and index has an explicit name: `pk_`, `fk_`, `ck_<schema>_<table>_<col>`,
  `ux_<schema>_<table>_<cols>` for unique indexes, `ix_<schema>_<table>_<cols>` for the rest.
- `CHECK` constraints for enums (`status IN (...)`), for cents (`amount_cents >= 0`) and for
  `version > 0`. Aggregate tables carry `version integer NOT NULL` for optimistic locking.
- No foreign keys across schemas (ADR 008); keep the id and note the owning module in a comment.
- `down` undoes exactly what `up` did, in reverse order, and is exercised: run, revert, run again
  (`/migration` does this).
- Never edit a migration that has reached `main`; add a new one. Never `synchronize`.
- Large tables: create indexes `CONCURRENTLY` in a migration with `transaction = false`.
