# Tramo

[![CI](https://github.com/andrey342/tramo/actions/workflows/ci.yml/badge.svg)](https://github.com/andrey342/tramo/actions/workflows/ci.yml)

Backend for an education financing platform: students apply for financing of a training program,
the platform verifies and scores them, signs a contract, pays the training center up front and
collects monthly instalments or income-share payments afterwards.

## What it does

- **Catalog.** Training centers are registered and verified against the EU VAT registry (VIES);
  they publish programs with their price, employability figures and the financing they accept:
  monthly instalments and income share agreements (ISA).
- **Application.** A student applies for a program; a saga checks identity, employment history
  and the credit bureau, and a versioned risk policy scores the result into an explainable
  decision: approved with an offer, rejected, or sent to an analyst.
- **Contract.** An accepted offer becomes a contract signed through an e-signature provider;
  once signed, the center is paid the principal less the platform fee.
- **Repayment.** Instalments follow a French amortisation schedule; an ISA charges a share of
  the income the student declares each month, with a minimum income, a cap and a maximum number
  of payments. A payoff settles a contract early.
- **Collection.** A monthly billing run turns what is due into charges collected by SEPA direct
  debit through a payment provider; dunning retries failed charges, puts contracts in arrears and
  writes off what is not recovered. A defaulted loan's principal left to bill is written off with
  the default. The student sees a statement.
- **Notifications and reporting.** Emails to students and centers, signed webhooks to centers
  with retries, and dashboards built from the events for centers and operations.

Identity, employment, bureau, e-signature, bank and payment providers are simulated behind ports
and answer deterministically (see the demo data below). VAT checks are answered by an offline fake
locally; `VIES_MODE=test` asks the real VIES test service instead (see `VIES_MODE` below).

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

Once the api is healthy, the one-shot `seed` container loads the demo data set (accounts below)
and exits; it runs on every `up` and leaves what exists alone. Wait for it before trying the API:

```bash
docker compose ps -a seed    # STATUS "Exited (0)": the demo data is in place
docker compose logs seed     # what it created; the last line is "seed: done"
```

Until then it shows `Created` (waiting for the api) or `Up` (running). `Exited (1)` means it did
not finish: its logs end with `seed failed: ...` or `seed incomplete: ...` (a center left
inactive, so its programs are missing). Fix what the log names and run it again in the
foreground; it picks up where it stopped:

```bash
docker compose run --rm seed
```

### Where to look

| What                                 | URL                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| API (versioned)                      | http://localhost:3000/api/v1                                                                |
| OpenAPI / Swagger UI                 | http://localhost:3000/docs (JSON: `/docs/openapi.json`)                                     |
| Readiness (Postgres, Redis)          | http://localhost:3000/health/ready                                                          |
| Bull Board (queues, dead letters)    | http://localhost:3000/admin/queues (user `ops`, password `tramo-queues`)                    |
| Prometheus metrics                   | http://localhost:3000/metrics (`Authorization: Bearer tramo-local-metrics-token-change-me`) |
| Mailpit (captured email)             | http://localhost:8025                                                                       |
| Webhook sink (deliveries to centers) | http://localhost:9099/deliveries                                                            |

Every port is bound to 127.0.0.1, so the demo accounts and development secrets are not reachable
from the network. If a port is already taken on your machine, override it in `.env` (`API_PORT`, `POSTGRES_PORT`,
`REDIS_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`, `WEBHOOK_SINK_PORT`).

Stop with `docker compose down`; add `-v` to also drop the database and Redis volumes.

## Try it in 2 minutes

Once the seed has exited with 0 (see above):

```bash
docker compose exec api node dist/scripts/demo.js   # or `pnpm demo` with Node and pnpm installed
```

The demo drives the API like a client would and prints each step: a new student registers,
applies for the full stack bootcamp in 24 instalments and submits; the worker runs the identity,
employment and credit checks and scores the application (the decision lists each factor); the
student accepts the offer and signs the contract (the demo plays the e-signature provider's
signed callback) and authorises the direct debit; the worker pays the center its share and the
contract becomes active; operations run billing as of the first due date and the simulated
payment provider collects it; then the statement, the center's dashboard, the emails in Mailpit
and the signed webhooks the sink received. It takes about fifteen seconds and can be run again.

## Local development

Requirements: Node.js 24 (see `.nvmrc`), pnpm through Corepack, Docker.

```bash
corepack enable pnpm
pnpm install
cp .env.example .env                 # if not done yet
docker compose --profile dev up -d   # only postgres, redis, mailpit and the webhook sink
pnpm migration:run                   # create the schema (the compose api does this by itself)
SEED_WEBHOOK_URL=http://localhost:9099/codeworks pnpm seed   # optional demo data
pnpm start:dev                       # api on :3000, watch mode (one terminal)
pnpm worker:dev                      # worker, health on :3100 (another terminal)
```

`SEED_WEBHOOK_URL` points the demo center's webhook at the sink as a worker on the host reaches
it; the compose seed uses the sink's service name instead.

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
| `pnpm seed`                                | Build, then create the demo data set described below (idempotent)       |
| `pnpm demo`                                | Walk the happy path against the running stack (see Try it in 2 minutes) |

`pnpm seed` writes the demo data set to the database in `.env`: two training centers whose VAT
numbers are verified (Codeworks Barcelona and Berlin Code Academy, three published
programs each, from a 4,200 EUR cybersecurity course to a 9,900 EUR data science master), a third
whose VAT number the registry refuses (it stays pending), Codeworks' webhook pointed at the
compose sink, and five students whose applications have run through verification and scoring.
The centers are checked as they are created; a registry that does not answer is asked again three
times over 14 seconds, after which the seed exits with 1 and can be run again.
The simulated providers answer from the national id: a number ending in 7 is in the default
registry and one ending in 9 fails the identity check. All accounts share the password
`tramo demo password`; local use only.

| Role                               | Email                      | Scenario                                                    |
| ---------------------------------- | -------------------------- | ----------------------------------------------------------- |
| admin                              | `admin@tramo.test`         |                                                             |
| ops                                | `ops@tramo.test`           | Works the review queue                                      |
| center admin (Codeworks Barcelona) | `admin@codeworks.test`     |                                                             |
| center admin (Berlin Code Academy) | `admin@berlin-code.test`   |                                                             |
| student                            | `ana.garcia@example.com`   | Instalments approved (bootcamp); a second one in review     |
| student                            | `bruno.silva@example.com`  | Income share agreement approved                             |
| student                            | `carla.moreno@example.com` | In the ops review queue                                     |
| student                            | `diego.lopez@example.com`  | Rejected: listed in the default registry (national id ...7) |
| student                            | `elena.ruiz@example.com`   | Rejected: identity check failed (national id ...9)          |

Configuration is read from the environment and validated with zod at startup; an invalid or
missing variable stops the process with a message naming it. A local `.env` is loaded if present,
but real environment variables always win. All variables and their defaults are in
[`.env.example`](.env.example); the main ones:

| Variable                                                                                                              | Purpose                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                        | Postgres connection string                                                                                                                                                                                                                                                         |
| `REDIS_URL`                                                                                                           | Redis connection string                                                                                                                                                                                                                                                            |
| `PORT`, `WORKER_HEALTH_PORT`                                                                                          | HTTP ports of the api and of the worker health endpoint                                                                                                                                                                                                                            |
| `LOG_LEVEL`, `LOG_PRETTY`                                                                                             | Pino level; pretty output for local runs only                                                                                                                                                                                                                                      |
| `CORS_ORIGINS`                                                                                                        | Comma-separated allowlist                                                                                                                                                                                                                                                          |
| `SWAGGER_ENABLED`                                                                                                     | Serve `/docs` (default on, off when `NODE_ENV=production`)                                                                                                                                                                                                                         |
| `DATABASE_RUN_MIGRATIONS`                                                                                             | Apply pending migrations when the api starts                                                                                                                                                                                                                                       |
| `JWT_ACCESS_SECRET`                                                                                                   | HS256 key for access tokens (32+ characters, required). With `NODE_ENV=production` the published development value is refused                                                                                                                                                      |
| `FIELD_ENCRYPTION_KEY`                                                                                                | AES-256 key (32 bytes, base64) for encrypted columns such as payout IBANs (ADR 014). The published development value is refused in production                                                                                                                                      |
| `VERIFICATION_PROVIDERS`, `SIMULATED_PROVIDER_LATENCY_MS`                                                             | Applicant checks (KYC, employment history, credit bureau): only `simulated` exists, and a production process refuses to start with it; how long they take to answer, `min-max` ms                                                                                                  |
| `LENDING_PROVIDERS`, `ESIGN_WEBHOOK_SECRET`, `ESIGN_WEBHOOK_PREVIOUS_SECRET`                                          | E-signature provider and bank: only `simulated` exists (an IBAN ending in 0000 bounces), refused in production; HMAC key of the provider's callbacks to `/webhooks/esign` (32+ characters; the published value is refused in production) and the one it replaces during a rotation |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`                                   | Mail server of the emails (Mailpit in compose, UI on :8025) and their sender                                                                                                                                                                                                       |
| `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_RETRY_DELAY_MS`, `WEBHOOK_PRIVATE_TARGETS_ENABLED`                                     | Webhooks to centers: one attempt timeout, the first retry delay (doubling, five attempts per round), and whether a private address may be the target (on outside production; production refuses to start with it on and posts only https to public addresses)                      |
| `BILLING_FUTURE_RUNS_ENABLED`                                                                                         | Whether ops may run billing and dunning as of a day still to come (the demo walks the months); on by default outside production                                                                                                                                                    |
| `PAYMENT_PROVIDER`, `PSP_WEBHOOK_SECRET`, `PSP_WEBHOOK_PREVIOUS_SECRET`, `PSP_CALLBACK_URL`, `SIMULATED_PSP_DELAY_MS` | Direct debits: only `simulated` exists (an amount ending in 13 cents is refused), refused in production; HMAC key of its callbacks to `/webhooks/psp` and the previous one; where the worker reaches the api for them, and after how long                                          |
| `VIES_MODE`, `VIES_TIMEOUT_MS`                                                                                        | VAT checks of training centers: `fake` (local default, offline: 200 invalid, 300 an outage, others valid), `test` (the real VIES test service, online: 100 valid, 200 invalid, others an outage) or `live` (VIES; the only mode production accepts). Switch on a fresh database    |
| `JWT_ACCESS_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`                                                                    | Session lifetimes (15 minutes, 30 days)                                                                                                                                                                                                                                            |
| `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_*`                                                                                  | Progressive lockout after failed sign-ins                                                                                                                                                                                                                                          |
| `THROTTLE_LIMIT`, `THROTTLE_AUTH_LIMIT`, `TRUST_PROXY_HOPS`                                                           | Rate limits per client and proxy setting                                                                                                                                                                                                                                           |
| `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_ENQUEUE_TIMEOUT_MS`                                           | Worker outbox publisher pacing                                                                                                                                                                                                                                                     |
| `BULL_BOARD_USERNAME`, `BULL_BOARD_PASSWORD`                                                                          | Basic auth for `/admin/queues`; no password disables it                                                                                                                                                                                                                            |
| `METRICS_TOKEN`                                                                                                       | Bearer token for `/metrics`, 32+ characters (an older `.env` with a shorter one stops the processes at startup); empty disables it                                                                                                                                                 |

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

Coverage has two gates. `pnpm test:cov` holds every `domain/` folder to 95 % of statements and
lines (90 % of branches). The global gate merges the three levels, since persistence and HTTP are
only reached by integration and e2e tests: 80 % of statements, lines and functions, 70 % of
branches.

```bash
pnpm test:cov && pnpm test:int:cov && pnpm test:e2e:cov
pnpm coverage:check   # merges coverage/{unit,int,e2e}
```

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
[`docs/architecture.md`](docs/architecture.md), next to the diagrams and the rules each module
enforces. The terms of the domain are in [`docs/domain-glossary.md`](docs/domain-glossary.md);
operating the stack (health, metrics, dead letters, retries, rebuilds) is in
[`docs/runbook.md`](docs/runbook.md).

```mermaid
flowchart LR
  student([Student]) -->|HTTPS| api
  center([Training center]) -->|HTTPS + API key| api
  ops([Operations]) -->|HTTPS| api

  subgraph tramo [Tramo]
    api[api<br/>NestJS HTTP]
    worker[worker<br/>queues, outbox publisher]
  end

  api --> pg[(PostgreSQL<br/>schema per module)]
  worker --> pg
  api --> redis[(Redis<br/>queues, rate limits, idempotency)]
  worker --> redis
  worker -->|SMTP| mail[Mailpit]
  worker -->|signed webhooks| sink[Center webhook endpoint]
```

| Module          | Responsibility                                                                                                        | Main endpoints                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `iam`           | Accounts, sessions, roles, center API keys                                                                            | `/auth/*`, `/me`, `/centers/:id/users`, `/centers/:id/api-keys`                                                                       |
| `catalog`       | Training centers, VAT verification, programs and their financing options                                              | `/centers`, `/centers/:id/verify-vat`, `/centers/:id/programs`, `/programs` (public)                                                  |
| `origination`   | Financing applications, verification saga, risk policies and scoring                                                  | `/applications`, `/applications/:id/{submit,decision,accept-offer,cancel}`, `/ops/applications/*`, `/risk-policies`                   |
| `lending`       | Contracts, e-signature, disbursement to the center and the repayment plan                                             | `/contracts`, `/contracts/:id/{document,schedule,payoff-quote,payoff}`, `/ops/disbursements/:id/{retry,reconcile}`, `/webhooks/esign` |
| `billing`       | SEPA mandates, billing cycle, collection through the PSP, dunning, ISA income declarations and the ledger             | `/contracts/:id/{mandate,income-declarations,charges,statement}`, `/charges/:id/retry`, `/ops/{billing,dunning}/run`, `/webhooks/psp` |
| `notifications` | Emails to students and centers, signed webhooks to centers with retries and redelivery                                | `/centers/:id/webhook`, `/centers/:id/webhook-deliveries`, `/centers/:id/webhook-deliveries/:deliveryId/redeliver`                    |
| `reporting`     | Read models of the portfolio: center dashboards, program performance and the ops overview, rebuilt from the event log | `/centers/:id/dashboard`, `/centers/:id/programs/:programId/performance`, `/ops/overview`, `/ops/reporting/rebuild`                   |

## API overview

The OpenAPI document at `/docs` lists every endpoint with its schemas and error responses, and
[`docs/api`](docs/api) holds a [Bruno](https://www.usebruno.com) collection that walks the main
flows against the local stack with the demo accounts. Errors are `application/problem+json`
(RFC 9457) with a stable `code`.

The program catalog (`GET /api/v1/programs`, `GET /api/v1/programs/:id`) is public. Every other
route requires authentication unless documented otherwise. Two ways in:

- **Users** (students, center staff, operations, admins): `POST /api/v1/auth/login` returns a
  15-minute bearer access token and a single-use refresh token. Send
  `Authorization: Bearer <accessToken>`; renew with `POST /api/v1/auth/refresh`. Reusing an old
  refresh token ends the session. Students self-register with `POST /api/v1/auth/register`;
  center administrators are created by an admin (`POST /api/v1/centers/:id/users`).
- **Training center integrations**: a center administrator issues an API key with explicit
  scopes (`POST /api/v1/centers/:id/api-keys`, the key is shown once). Send it as
  `X-Api-Key: tramo_<prefix>_<secret>`. Keys only work on endpoints that declare the scopes they
  need. A key may be given an end date (`expiresAt`); without one it works until revoked, and it
  stops working at once when its center is suspended.

```bash
curl -s -X POST localhost:3000/api/v1/auth/register -H 'content-type: application/json'   -d '{"email":"ana@example.com","password":"correct horse battery"}'
curl -s -X POST localhost:3000/api/v1/auth/login -H 'content-type: application/json'   -d '{"email":"ana@example.com","password":"correct horse battery"}'
curl -s localhost:3000/api/v1/me -H "Authorization: Bearer <accessToken>"
```

A financing application, end to end (as the demo student; `pnpm api:call` signs in for you):

```bash
pnpm api:call POST /applications '{"programId":"<id from GET /programs>","product":{"kind":"installments","termMonths":24},"profile":{"dateOfBirth":"1998-05-20","nationalId":"56781234F","residenceCountry":"ES","declaredMonthlyIncomeCents":180000,"employmentStatus":"employed"}}' --as student
pnpm api:call POST '/applications/{{last.id}}/submit' --as student
pnpm api:call GET '/applications/{{last.id}}/decision' --as student
```

Submitting starts the verification saga in the worker: identity (KYC), employment history and a
credit bureau check run as three jobs, then the application is scored with the risk policy in
force and approved, sent to the ops review queue (`GET /ops/applications/review-queue`) or
rejected. The providers are simulated and answer deterministically from the national id: one
ending in 9 fails identity verification, one ending in 7 is in a default registry. Applications
nobody touches for 14 days expire, except those waiting for an analyst.

An approved offer shows the monthly instalment and the TAE (`terms`). Accepting it hands it to
lending, which draws up the contract and sends it for signature; then:

```bash
pnpm api:call POST '/applications/<id>/accept-offer' --as student
pnpm api:call GET /contracts --as student
pnpm esign:sign <contractId>
pnpm api:call GET '/contracts/<contractId>/schedule' --as student
pnpm api:call POST '/contracts/<contractId>/payoff-quote' '{}' --as student
```

`pnpm esign:sign` plays the student signing at the (simulated) provider: it posts the signed
callback to `POST /webhooks/esign`. The worker then pays the center the price less its platform
fee, and once the transfer settles the contract is active and its instalment table is drawn
(ADR 016). A center whose IBAN ends in 0000 has its transfer bounced: ops see it in
`GET /ops/disbursements?status=failed` and send it again with `POST /ops/disbursements/:id/retry`; one whose jobs ran out (a long bank
outage) is reconciled with `POST /ops/disbursements/:id/reconcile`.

Repayment, by direct debit (the student signs a mandate, ops run the month as of a day):

```bash
pnpm api:call POST '/contracts/<contractId>/mandate' '{"iban":"ES7620770024003102575766"}' --as student
pnpm api:call POST '/ops/billing/run?asOf=<first due date>&contractId=<contractId>' --as ops
pnpm api:call GET '/contracts/<contractId>/charges' --as student
pnpm api:call GET '/contracts/<contractId>/statement' --as student
pnpm api:call POST '/ops/dunning/run?asOf=<a later day>' --as ops
```

The billing run charges what falls due that month and submits it to the (simulated) payment
provider, which answers a couple of seconds later on `POST /webhooks/psp`: the charge is paid, the
instalment marked in the plan and the statement balanced. An amount ending in 13 cents is refused,
and dunning takes over: notices, retries at 3 and 7 days, arrears at 30, default at 90. One
ending in 14 cents is collected and then returned by the student's bank: owed again, unpaid on
the plan, and dunned from the day of the return. In
production the cycle runs on the 1st and the 5th, collection and dunning every morning. ISA
students declare a month's income with `POST /contracts/:id/income-declarations` until the 4th of
the next month; on the 5th the month is charged. An ISA signed today starts paying months later
(`firstPeriod` on its schedule): to see one charged, declare that month with `?asOf=` set to the
2nd of the next month, then run billing as of the 5th (both need `BILLING_FUTURE_RUNS_ENABLED`, on
outside production).

Every step above writes to someone: the student receives emails (welcome, application received,
decision, contract ready to sign, payment reminders and receipts, overdue notices, ISA declaration
reminders and missing declarations) and the center's admins the disbursement; they land in Mailpit
(http://localhost:8025). A center also receives its events by webhook once its admin points it
at a URL; in compose, the webhook sink stands in for the center:

```bash
pnpm api:call PUT '/centers/<centerId>/webhook' '{"url":"http://webhook-sink:9099/codeworks"}' --as center
pnpm api:call GET '/centers/<centerId>/webhook-deliveries' --as center
curl -s http://localhost:9099/deliveries
```

The answer to the `PUT` carries the signing secret, once. Each delivery is signed
(`X-Tramo-Signature: t=<unix>,v1=<HMAC-SHA256 of "<t>.<body>">`), attempted up to five times
(the first try included) with backoff, and can be asked for again with
`POST /centers/<centerId>/webhook-deliveries/<deliveryId>/redeliver` (ADR 018). To verify one,
compute the HMAC of `"<t>.<raw body>"` with the secret, refuse a `t` more than five minutes away,
and accept the request when any `v1` matches: for 24 hours after a rotation (configuring the
webhook again) each delivery carries one `v1` per secret, the new one first.

The center sees its portfolio, and operations their day, in read models built from the events
(ADR 019); they can be thrown away and rebuilt from the outbox (do it once on a database that
already had activity before reporting existed):

```bash
pnpm api:call GET '/centers/<centerId>/dashboard' --as center
pnpm api:call GET '/centers/<centerId>/programs/<programId>/performance' --as center
pnpm api:call GET '/ops/overview' --as ops
pnpm api:call POST '/ops/reporting/rebuild' --as ops
```

Sign-in is rate limited per client (`THROTTLE_AUTH_LIMIT`, 10 per minute) and accounts are locked
progressively after five failed attempts. An admin disables an account with
`POST /api/v1/users/:id/disable`, which also ends all its sessions.

## Developer tooling

The repo versions its developer tooling, so routine work follows the same conventions however it
is done (ADR 011). [`CLAUDE.md`](CLAUDE.md) is the short map: commands, architecture principles and
workflow. Under `.claude/`:

- `rules/`: conventions loaded only for the paths they cover (domain, migrations, HTTP, tests).
- `skills/`: procedures backed by scripts that also run on their own, e.g. `/new-module payouts`
  or `pnpm scaffold:module payouts --responsibility "..."`.

  | Script                                                      | What it does                                                                                    |
  | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | `pnpm scaffold:module <name>`                               | New bounded context shaped like `iam`, registered in the app, worker, queues, schema and README |
  | `pnpm scaffold:use-case <module> <Name> --command\|--query` | Command or query, handler, DTO and spec on in-memory fakes                                      |
  | `pnpm scaffold:adapter <module> <Port> <name>`              | Adapter stub, shared contract suite, fake and the specs that run the contract on both           |
  | `pnpm migration:verify generate\|new\|check\|lint`          | Write a migration; run, revert and run again comparing schema dumps                             |
  | `pnpm adr:new "<title>"`                                    | Next decision record and its row in `docs/architecture.md`                                      |
  | `pnpm api:call <METHOD> <path> [body] [--as role]`          | Call the running api as a demo user; tokens and the last response are kept in `.local/`         |
  | `pnpm trace <aggregateId>`                                  | Timeline of an aggregate: events, jobs, consumers, dead letters, audit, mail, webhooks          |
  | `pnpm queue:inspect [queue] [jobId] [--retry\|--remove]`    | Queue counts, failed jobs and their stacks, outbox, dead letters (`--retry-dead-letters`)       |

- `agents/`: read-only reviewers for architecture and security, each with a fixed checklist;
  `/review-module <module>` runs both with the dependency rules and the module's coverage.
- `settings.json`: edited files are formatted and linted after each change; commands starting
  with `git push --force`/`-f` or `docker compose down -v`, or containing `schema:sync`, are
  denied. The rules match command prefixes: a guardrail against slips, not a sandbox.

[`.mcp.json`](.mcp.json) adds two MCP servers: Context7 for current library documentation, and
Postgres MCP Pro in restricted mode (read-only transactions, time limit) for query plans,
hypothetical indexes (`hypopg`) and workload analysis (`pg_stat_statements`), used by
`/sql-explain`. It connects as `tramo_ro`, a role that can only read the module schemas. The
compose Postgres image adds both extensions and creates the role on a new volume; an existing
volume catches up with:

```bash
docker compose exec postgres psql -U tramo -d tramo -f /docker-entrypoint-initdb.d/02-diagnostics.sql
```

## Project layout

```text
src/
  main.api.ts, main.worker.ts   entry points of the two processes
  app.module.ts, worker.module.ts
  shared/                       kernel: Money, Percentage, Clock, errors (domain); unit of work,
                                event bus, outbox, queues, HTTP pipeline, config (infrastructure)
  modules/<module>/             iam, catalog, origination, lending, billing, notifications, reporting
    domain/                     aggregates, value objects, events, repository ports; plain TypeScript
    application/                commands, queries, ports, DTOs: the module's public surface
    infrastructure/             TypeORM persistence and migrations, adapters, HTTP, jobs, consumers
test/                           factories, fakes, contract suites, integration and e2e tests
scripts/                        seed, demo, coverage gate, e-signature callback for local use
docs/                           architecture, ADRs, runbook, domain glossary, Bruno collection
docker/                         Dockerfile, Postgres image with extensions, webhook sink
```

## Roadmap and known limitations

- The identity, employment, bureau, e-signature, bank and payment providers are simulated; real
  ones go behind the existing ports, each with its contract suite. Production refuses to start
  with the simulated ones.
- Centers can be signed in Spain and Germany only (the VAT number rules of other countries are
  not modelled).
- Reporting computes figures per request from fact tables, and a rebuild replays the whole outbox
  in one transaction; at volume both would move to summary tables and a shadow rebuild (ADR 019).
- The outbox is never pruned, since reporting replays it; it needs an archive at volume.
- One currency (EUR). Days (due dates, the ISA window) are taken from instants in UTC, which a
  center or student in another timezone may see shifted around midnight.
- No password change or reset, and no invitation flow: an admin sets a center administrator's
  first password, and an account whose password is lost or leaked can only be disabled. A
  disabled account's access tokens keep working until they expire (15 minutes).
- No tracing backend: correlation ids join logs, jobs and webhooks, and `/metrics` serves
  Prometheus, but no collector or dashboards ship with the stack.
