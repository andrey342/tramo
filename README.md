# Tramo

[![CI](https://github.com/andrey342/tramo/actions/workflows/ci.yml/badge.svg)](https://github.com/andrey342/tramo/actions/workflows/ci.yml)

Backend for an education financing platform: students apply for financing of a training program,
the platform verifies and scores them, signs a contract, pays the training center up front and
collects monthly instalments or income-share payments afterwards.

> Status: bootstrap. The runtime, infrastructure and quality gates are in place; the business
> modules land incrementally (see [Roadmap](#roadmap)).

## Quickstart

You need Docker (Docker Desktop, or Docker Engine with the Compose plugin) and Git. Nothing else.

```bash
git clone https://github.com/andrey342/tramo.git && cd tramo
cp .env.example .env
docker compose up --build
```

The first start builds the application image and pulls the base images, which takes a few
minutes. Later starts take seconds. The stack is ready when `api-1` logs
`Nest application successfully started` and `http://localhost:3000/health/ready` answers
`{"status":"ok",...}`. Add `--wait -d` to the last command to block until every container
reports healthy and get the terminal back.

### Where to look

| What                                 | URL                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------ |
| API (versioned)                      | http://localhost:3000/api/v1                                             |
| OpenAPI / Swagger UI                 | http://localhost:3000/docs (JSON: `/docs/openapi.json`)                  |
| Readiness (Postgres, Redis)          | http://localhost:3000/health/ready                                       |
| Bull Board (queues, dead letters)    | http://localhost:3000/admin/queues (user `ops`, password `tramo-queues`) |
| Mailpit (captured email)             | http://localhost:8025                                                    |
| Webhook sink (deliveries to centers) | http://localhost:9099/deliveries                                         |

If a port is already taken on your machine, override it in `.env` (`API_PORT`, `POSTGRES_PORT`,
`REDIS_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `WEBHOOK_SINK_PORT`).

Stop with `docker compose down`; add `-v` to also drop the database and Redis volumes.

## Local development

Requirements: Node.js 24 (see `.nvmrc`), pnpm through Corepack, Docker.

```bash
corepack enable pnpm
pnpm install
docker compose --profile dev up -d   # only postgres, redis, mailpit and the webhook sink
pnpm start:dev                       # api on :3000, watch mode
pnpm migration:run                   # create the schema (the compose api does this by itself)
pnpm worker:dev                      # worker, health on :3100
```

The `dev` profile on the command line takes precedence over `COMPOSE_PROFILES=demo` from `.env`,
so the api and worker containers are not started and the host processes own ports 3000 and 3100.

| Script                                     | What it does                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm start:dev` / `pnpm worker:dev`       | Run the api / worker with `nest start --watch`                          |
| `pnpm build`                               | Compile to `dist/`                                                      |
| `pnpm start`                               | Run the compiled api                                                    |
| `pnpm lint` / `pnpm format`                | ESLint (type-aware) / Prettier                                          |
| `pnpm typecheck`                           | `tsc --noEmit` over sources, tests and scripts                          |
| `pnpm arch:check`                          | Dependency rules between layers and modules                             |
| `pnpm test` / `pnpm test:cov`              | Unit tests / with coverage                                              |
| `pnpm test:int`                            | Repository and outbox tests against Postgres and Redis (Testcontainers) |
| `pnpm test:e2e`                            | HTTP tests against Postgres and Redis (Testcontainers)                  |
| `pnpm migration:run` / `:revert` / `:show` | Build, then apply / undo the last / list migrations                     |
| `pnpm migration:generate <path>`           | Build, then generate a migration from entity changes                    |

Configuration is read from the environment and validated with zod at startup; an invalid or
missing variable stops the process with a message naming it. A local `.env` is loaded if present,
but real environment variables always win. All variables and their defaults are in
[`.env.example`](.env.example); the main ones:

| Variable                                       | Purpose                                                 |
| ---------------------------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`                                 | Postgres connection string                              |
| `REDIS_URL`                                    | Redis connection string                                 |
| `PORT`, `WORKER_HEALTH_PORT`                   | HTTP ports of the api and of the worker health endpoint |
| `LOG_LEVEL`, `LOG_PRETTY`                      | Pino level; pretty output for local runs only           |
| `CORS_ORIGINS`                                 | Comma-separated allowlist                               |
| `SWAGGER_ENABLED`                              | Serve `/docs`                                           |
| `DATABASE_RUN_MIGRATIONS`                      | Apply pending migrations when the api starts            |
| `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE` | Worker outbox publisher pacing                          |
| `BULL_BOARD_USERNAME`, `BULL_BOARD_PASSWORD`   | Basic auth for `/admin/queues`; no password disables it |

## Testing

```bash
pnpm test          # unit tests, no Docker needed
pnpm test:int      # needs a running Docker daemon (Testcontainers)
pnpm test:e2e      # same
pnpm lint
pnpm typecheck
pnpm arch:check
```

Integration and e2e tests start Postgres and Redis containers once per run and build the schema
with the real migrations. E2E tests build the application through the same HTTP setup as `main.api.ts`, so they exercise routing, validation and error rendering as
deployed. CI runs all of the above plus the Docker image build on every pull request.

On Docker Desktop (Windows), run the suites with only the `dev` profile up, not the full stack:
with the api and worker containers also running we have seen sporadic `ECONNRESET` on the test
containers' published ports. `docker compose stop api worker` is enough.

## Architecture

A modular monolith with two runtime processes built from the same image: `api` (HTTP) and
`worker` (queue processors and the outbox publisher, only `/health` over HTTP). State changes and
their domain events are committed together to a transactional outbox; the worker delivers them to
per-module BullMQ queues, and consumers apply each event exactly once. Each bounded
context is a hexagonal module; layer and module boundaries are enforced by `pnpm arch:check`.
Decisions are recorded as ADRs in [`docs/adr`](docs/adr) and summarised in
[`docs/architecture.md`](docs/architecture.md).

## Roadmap

- Shared kernel: value objects, unit of work, transactional outbox, BullMQ, idempotency.
- Identity and access, catalog of centers and programs, origination and scoring, lending,
  billing and dunning, notifications and reporting.
- Seed data, an end-to-end demo script and an API collection.
