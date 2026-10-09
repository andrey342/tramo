# 008. One Postgres schema per module, no foreign keys across schemas

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Module boundaries (ADR 001) are enforced in code by dependency rules. Without an equivalent in the
database, a query can join another module's tables and recreate the coupling the code avoids.

## Decision outcome

- Each module owns a schema: `iam`, `catalog`, `origination`, `lending`, `billing`,
  `notifications`, `reporting`. Cross-cutting infrastructure (outbox, processed events, audit log)
  lives in `shared`.
- A module's migrations, entities and queries only touch its own schema (and `shared` through the
  shared infrastructure). Data owned by another module is either received through events and kept
  as a local copy (for example, a program snapshot inside an application) or requested through
  that module's facade.
- References across schemas are plain ids with no foreign key. Integrity across modules is a
  process concern (events and sagas), not a database constraint.
- Schemas are created by the first migration that needs them (`CREATE SCHEMA IF NOT EXISTS`), so
  test databases do not depend on the compose init script, which also creates them.

### Consequences

- Good: moving a module to its own database later is a dump of one schema plus replacing in-process
  facades with remote calls.
- Good: ownership of every table is obvious from its name.
- Bad: no referential integrity across modules; orphaned references must be prevented by the
  workflows and caught by reconciliation queries.
- Bad: some reads need data from several modules; those go to the reporting projections (CQRS read
  side) rather than to cross-schema joins.
