# 001. Modular monolith with separate api and worker processes

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Tramo covers several bounded contexts (identity, catalog, origination, lending, billing,
notifications, reporting) that will evolve at different speeds. The team is small, the domain is
still being discovered, and the system must run end to end with a single `docker compose up`.
How should the code and the runtime be split?

## Decision drivers

- Clear ownership boundaries between contexts from day one.
- Low operational cost: one repository, one build, one image, one database server.
- Ability to extract a context into its own service later without rewriting it.
- Background work (verification calls, billing cycles, webhooks) must not compete with request
  latency.

## Considered options

1. Microservices, one per bounded context.
2. Layered monolith (controllers, services and repositories shared by everything).
3. Modular monolith with strict module boundaries and two runtime processes.

## Decision outcome

Option 3. The code is one Nest application split into modules under `src/modules/<context>`.
Modules communicate only through domain events (transactional outbox and BullMQ) or a module's
`application/dto` facade; no module imports another module's internals. Each module owns a
Postgres schema with no foreign keys across schemas (ADR 008).

The same image runs as two processes: `api` serves HTTP; `worker` runs queue processors,
repeatable jobs and the outbox publisher, and only exposes `/health`.

Boundaries are verified, not assumed: `pnpm arch:check` (dependency-cruiser) fails CI when a module
reaches into another module's internals or a layer imports outward.

### Consequences

- Good: one deployment unit and local transactions inside a module; refactors across modules are
  cheap while the domain settles.
- Good: the extraction path is mechanical. A module already talks to others through events and a
  facade and owns its schema, so it can move behind a queue and its own database.
- Good: api and worker scale independently and a slow job never blocks a request.
- Bad: one shared runtime; a memory leak in one module affects all of them.
- Bad: discipline is enforced by tooling, so the rules must be kept current as modules appear.

### Rejected options

- Microservices: network calls, distributed transactions and per-service deployment for a team
  that does not yet know where the stable boundaries are.
- Layered monolith: cheapest today, but boundaries erode silently and extraction later means
  untangling shared services and tables.
