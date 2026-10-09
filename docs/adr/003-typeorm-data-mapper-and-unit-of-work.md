# 003. TypeORM as a data mapper, unit of work through CLS

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Aggregates must be persisted together with the events they raise (ADR 004), and several
repositories may take part in one use case. Domain classes must not carry ORM decorators
(ADR 002). How do repositories share a transaction without threading a transaction object through
every handler and repository signature?

## Decision outcome

- TypeORM, used strictly as a data mapper. Each module has `*.orm-entity.ts` classes and a mapper
  to and from the domain aggregate. Repositories implement the domain port and return aggregates,
  never ORM entities.
- `UnitOfWork` is an application port with one method, `run(work)`. The implementation uses
  `@nestjs-cls/transactional` with the TypeORM adapter: the active `EntityManager` lives in
  async-local storage (`nestjs-cls`), and repositories read it from `TransactionHost.tx`. Nested
  `run` calls join the outer transaction.
- The outbox writer refuses to run outside a transaction, so "saved the aggregate but lost its
  events" cannot happen silently.
- Schema changes only come from hand-reviewed migrations (`synchronize` is never enabled). The api
  applies pending migrations at startup in the compose stack; elsewhere they run with
  `pnpm migration:run`. Each migration runs in its own transaction.

### Consequences

- Good: handlers read like the use case (`uow.run(() => { load; act; save })`) and repositories
  stay unaware of whether they are inside a transaction.
- Good: the same CLS context carries the request id into logs, outbox rows and jobs.
- Bad: implicit context. Code that escapes the async chain (a callback scheduled on a raw
  EventEmitter, for example) loses the transaction; integration tests cover the paths that matter.
- Bad: TypeORM's typings for JSON columns and partial entities are loose; mappers own the
  conversion and are tested against a real database.

### Rejected options

- Prisma: good DX, but its client is the model, which pushes towards persistence-shaped
  aggregates, and interactive transactions are callback-scoped in a way that leaks into handlers.
- Passing an explicit transaction or `EntityManager` parameter: explicit, but every port and
  handler signature grows a persistence concern.
