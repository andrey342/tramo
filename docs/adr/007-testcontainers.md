# 007. Integration and e2e tests against real Postgres and Redis

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

The interesting failures in this system live at the boundaries: SQL that only Postgres rejects,
`FOR UPDATE SKIP LOCKED` behaviour, JSONB mapping, transaction propagation, Redis expiry and
BullMQ semantics. In-memory fakes and SQLite pass where production fails.

## Decision outcome

- Integration (`pnpm test:int`, files `*.int-spec.ts`) and e2e (`pnpm test:e2e`) suites start
  Postgres 16 and Redis 7 with Testcontainers, using the same image tags as the compose stack.
- Containers start once per run in Jest's global setup; the database is built by running the real
  migrations, so a migration that does not match the entities fails the suite.
- Unit tests (`pnpm test`) need no Docker: domain code is pure and application handlers are tested
  with in-memory repositories.
- Mocks of the ORM or of Redis clients are not used. Ports to external providers have fakes, and
  each fake passes the same contract suite as the real adapter.

### Consequences

- Good: repository, outbox and idempotency tests exercise the actual SQL and locking behaviour.
- Good: CI runners and developer machines use the same setup; Docker is the only requirement.
- Bad: the first run pulls images and suites take seconds rather than milliseconds; integration and
  e2e tests run in band against a shared database, so tests use unique ids instead of truncating.
