# 013. Advisory locks for session families and startup migrations

- Status: accepted
- Date: 2026-10-10

## Context and problem statement

Two operations must not interleave, and row-level optimistic locking does not prevent it:

- Rotating a refresh token inserts the next token of the family while a logout (or a reuse
  revocation) updates every token of that family. Under READ COMMITTED the revoking `UPDATE` does
  not see the row the rotation is inserting, so the new token survives the logout.
- The api applies pending migrations at startup. With two replicas starting together, both run
  the same migration; one fails and crash-loops.

Both need "one at a time" over something that is not a single existing row. How should that be
serialised?

## Decision drivers

- Correctness under concurrency without changing the isolation level of every transaction.
- No new infrastructure: Postgres is already the source of truth for both.
- Locks must be released if the holder dies.

## Considered options

1. `SERIALIZABLE` transactions with retries for token rotation; a separate migration job for
   deployments.
2. A lock row per family (`SELECT ... FOR UPDATE`) and a migrations lock table.
3. Postgres advisory locks: transaction-scoped per family, session-scoped for migrations.

## Decision outcome

Option 3.

- Refresh rotation and family revocation take a transaction-scoped advisory lock keyed on
  `iam.refresh_family:<familyId>` (`pg_advisory_xact_lock` over `hashtextextended`) inside their
  unit of work. Rotation reads the token again after the lock, so it sees a revocation committed
  meanwhile; revocation's `UPDATE` runs after any rotation of the family has committed. The lock
  ends with the transaction.
- Startup migrations run through `runMigrationsExclusively`, which holds
  `pg_advisory_lock(<fixed key>)` on the connection that applies them. Other replicas wait, then
  find nothing pending. The lock ends with the session if the process dies.

### Consequences

- Good: no extra tables, no retry loops, and the locks disappear with the transaction or session
  that took them.
- Good: the integration tests reproduce both races deterministically (one transaction holds the
  lock while the other is observed waiting in `pg_locks`).
- Bad: advisory lock keys are a global namespace; keys are prefixed with the module and purpose
  to avoid collisions, and a 64-bit hash collision would only serialise two unrelated families.
- Bad: deployments with many replicas wait for the first one to migrate; a long migration
  delays their readiness, which is visible in the health checks.
