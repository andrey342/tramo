# 002. Hexagonal modules with tactical DDD and CQRS

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

The core of Tramo is rules, not plumbing: amortisation tables, income-share caps, scoring with an
explainable outcome, state machines for applications, contracts and charges. These rules must be
testable without Nest, a database or a network, and must not leak into controllers or SQL.

## Decision outcome

Every module follows the same layout (`domain`, `application`, `infrastructure`) with
dependencies pointing inward only, checked by `pnpm arch:check`.

- **Domain**: aggregates, value objects, domain services and repository ports. No Nest, no ORM.
  Invariants live in the aggregate and every state change goes through a method that checks the
  transition. Money is a value object (ADR 005), time comes from a `Clock` (ADR 009).
- **Application**: one command or query handler per use case (`@nestjs/cqrs`). A handler loads an
  aggregate, calls one method, saves it inside the unit of work and returns. Queries read
  projections or purpose-built SQL and never load aggregates, with one exception (added
  2026-10-10 after reviewing `iam`): a query that needs the current state of aggregates of its own
  module, looked up by id or by a lookup key, with a result bounded by design, may read them
  through the module's repository and map them to a DTO. `GetCurrentPrincipal`, `ListApiKeys`
  (a center holds a handful of keys) and `AuthenticateApiKey` do so; a projection would copy the
  same rows. Lists that grow, searches and anything read across modules use projections or SQL.
  `AuthenticateApiKey` also records the key's last use, a single bookkeeping `UPDATE` outside the
  unit of work, so authenticating a request stays one call.
- **Infrastructure**: controllers, TypeORM entities and mappers, adapters for external providers
  and BullMQ processors. Persistence entities are separate classes from domain aggregates; a
  mapper converts between them.

Errors follow one rule. Expected outcomes of parsing untrusted input are returned as
`Result<T, E>` (for example `NationalId.create`), so callers handle them explicitly. Broken
invariants inside an aggregate throw a typed `DomainError` with a stable `code` and a `category`
(`validation`, `not_found`, `conflict`, `rule_violation`, `forbidden`); the HTTP layer maps the
category to a status and the code to a Problem Details type (ADR 006). The domain never knows
about HTTP.

### Consequences

- Good: domain tests are plain Jest with no container, module or mock framework.
- Good: controllers are thin and uniform: validate, dispatch, map.
- Bad: more files per feature (entity, mapper, aggregate, handler, DTO) than an active-record
  style. The scaffolding skills generate the boilerplate.
- Bad: the mapper between persistence and domain models must be kept in sync; repository
  integration tests catch drift.

### Rejected options

- Active record or ORM entities as the domain model: fastest to write, but couples business rules
  to column decorators and makes rules testable only with a database.
- Full event sourcing: auditability is valuable here, but the outbox plus an audit log gives most
  of it without the operational cost of rebuilding state from streams.
