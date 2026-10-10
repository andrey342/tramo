# Tramo

Education-financing backend: students apply for financing of a course, Tramo scores the application,
signs a loan or income share agreement, disburses to the training center and collects instalments.
NestJS modular monolith with two processes (`api`, `worker`) built from one image.

## Commands

- `pnpm test` unit · `pnpm test:int` / `pnpm test:e2e` (Testcontainers, need Docker) · `pnpm test:cov`
- `pnpm lint` · `pnpm typecheck` · `pnpm arch:check` (dependency-cruiser, must report zero violations)
- `pnpm start:dev` / `pnpm worker:dev` against `docker compose --profile dev up -d` (infra only)
- `docker compose up -d --build --wait` runs the whole stack (api :3000, Swagger `/docs`, Bull Board
  `/admin/queues`, Mailpit :8025, webhook sink :9099)
- `pnpm migration:run|revert|show|generate` (CLI over the compiled data source)

## Architecture (details in `docs/architecture.md`, decisions in `docs/adr/`)

1. Hexagonal per module: `domain` (pure TS) ← `application` (use cases, ports) ← `infrastructure`
   (TypeORM, HTTP, adapters). Modules talk only through `application/dto` and `domain/events`.
2. Domain is framework free: no Nest, TypeORM or `new Date()`; time comes from the `Clock` port.
3. Side effects leave through the transactional outbox and BullMQ consumers, which are idempotent.
4. Money is integer cents (`Money`), rates are basis points (`Percentage`). Never a raw `number`.

Path-scoped rules in `.claude/rules/` cover domain, migrations, HTTP and tests.

## Workflow

- Branch `<type>/<module>-<topic>` from an up-to-date `main`; small Conventional Commits in English.
- Before a PR: tests, lint, typecheck and `arch:check` green, then `/code-review`; `/simplify` after
  each feature; `/security-review` before tagging a release.
- PR with `gh pr create`, wait for `gh pr checks --watch`, merge with `gh pr merge --merge --delete-branch`.
- Commit messages and staged files are checked by Husky; never bypass the hooks.
- A new architectural decision gets an ADR (`/adr`).

## Skills (`.claude/skills/`, each script also runs as a `pnpm` script)

| Skill                                 | Use it to                                                    |
| ------------------------------------- | ------------------------------------------------------------ |
| `/new-module <name>`                  | scaffold a bounded context shaped like `iam` and register it |
| `/new-use-case <module> <Name>`       | add a command or query with handler, DTO and spec on fakes   |
| `/add-adapter <module> <Port> <name>` | implement a port with a shared contract suite and a fake     |
| `/migration <module> <verb-noun>`     | write a migration and prove its `down` restores the schema   |
| `/adr <title>`                        | record a decision in `docs/adr` and the architecture index   |

## Do not

- `synchronize: true`, `schema:sync` or editing an applied migration; write a new one.
- Put logic in controllers or handlers that belongs to an aggregate.
- Mock the ORM or use SQLite in tests; integration tests run on real Postgres and Redis.
- `console.log`, `any`, `throw new HttpException(...)` (throw a `DomainError` or `ProblemException`).
- Cross-schema foreign keys or imports of another module's internals.
