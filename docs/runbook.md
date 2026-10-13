# Runbook

Operating the compose deployment (`docker-compose.yml`, profile `demo`), organised as symptom,
check, action. Terms are defined in the [glossary](domain-glossary.md), the design in
[`architecture.md`](architecture.md).

Conventions used below:

- Commands run from the repository root. `pnpm queue:inspect`, `pnpm trace`, `pnpm api:call` and
  the `pnpm migration:*` scripts run on the host (Node 24 and pnpm) and reach the stack through
  `DATABASE_URL`, `REDIS_URL` and `API_PORT` in `.env`, which must point at the compose ports.
- `pnpm api:call <METHOD> <path> [body] --as ops` signs in as the seeded demo account of that role
  and adds an `Idempotency-Key` to POSTs. Paths without a prefix go under `/api/v1`. With curl,
  send the bearer token and, on idempotent routes, an `Idempotency-Key` header yourself.
- `/health/*`, `/metrics` and `/admin/queues` are not under `/api/v1`.
- Retrying or removing a job changes state: decide it, and fix the cause first.

## Start, stop and readiness

- **Start**: `cp .env.example .env` once, then `docker compose up -d --build --wait`. It returns
  when the containers with a healthcheck report healthy. `--build` is needed after a code change.
- **What "ready" means**, in start order:
  - `postgres` (`pg_isready`) and `redis` (`redis-cli ping`) healthy; `mailpit` has no check;
    `webhook-sink` answers `GET /health`.
  - `api` applies pending migrations at startup (`DATABASE_RUN_MIGRATIONS=true`), then is healthy
    when `GET /health/ready` answers 200: Postgres and Redis each answered a ping within 1.5 s.
  - `worker` starts only once the api is healthy (the api migrates, the worker reads the outbox);
    healthy when its own `GET /health/ready` on port 3100 answers 200.
  - `seed` runs once the api is healthy, loads the demo data set (idempotent) and exits.
- **Check**:

  ```bash
  docker compose ps                         # health of every container
  curl -s localhost:3000/health/ready       # {"status":"ok","info":{"database":...,"redis":...}}
  curl -s localhost:3000/health/live        # the event loop answers; no dependency checked
  docker compose exec worker node -e "fetch('http://127.0.0.1:3100/health/ready').then(r=>r.text()).then(console.log)"
  ```

  A failing dependency gives 503 with Terminus' body naming it (`"database": {"status": "down"}`).
  Port 3100 is not published by compose; with the `dev` profile the host worker serves it on
  `localhost:3100`.

- **Stop**: `docker compose stop` keeps the containers; `docker compose down` removes them and
  keeps the volumes. `docker compose down -v` also deletes the Postgres and Redis volumes, every
  application, contract, charge and queued job included: never on a stack whose data you need.
- **Configuration**: the containers receive only the variables listed in the `x-app` environment
  of `docker-compose.yml`; `.env` feeds the `${...}` placeholders there, and is read directly only
  by processes run on the host. A variable missing from that list (`THROTTLE_*`, `LOGIN_*`,
  `*_PREVIOUS_SECRET`...) keeps its default in the stack. Apply a change with
  `docker compose up -d`, which recreates the containers whose configuration changed.

## Logs and following a request

- `docker compose logs -f api worker` (`--since 10m` to narrow). Lines are JSON (pino); those
  written within a request or a job carry `correlationId`.
- Each request has an id: the caller's `X-Request-Id` when well formed, otherwise a UUIDv7. It is
  returned in the `x-request-id` header, as `requestId` in Problem Details, and kept in
  `shared.audit_log` for audited routes.
- The outbox rows a request writes store it as `correlation_id`, and every job those events cause
  (and the jobs those jobs queue) runs with it as `correlationId`. One grep follows the request
  into the worker:

  ```bash
  docker compose logs api worker | grep <requestId>
  ```

  Scheduled jobs (billing cycle, sweeps) have no request; their id is `<queue>.<jobId>`.

- When the request id is unknown, start from the aggregate: `pnpm trace <aggregateId>` (an
  application, contract, charge, center or user id) prints its events, whether each was
  published, the jobs they fanned out to with their state, dead letters, consumers that applied
  them, audit entries (with request ids), emails written and found in Mailpit, and webhook
  deliveries. Lines marked `!!` are broken; the last line names the first broken link and the
  command to dig in.

## Metrics

`GET /metrics` serves Prometheus text to `Authorization: Bearer <METRICS_TOKEN>`
(`tramo-local-metrics-token-change-me` in compose). Without a configured token it answers 404; a
wrong token gets 401 and logs `Metrics scrape refused`. The backlog is read from Redis and Postgres
at scrape time, at most every five seconds, so the api's target covers the worker's queues too.

```bash
curl -s -H 'Authorization: Bearer tramo-local-metrics-token-change-me' localhost:3000/metrics | grep -E '^tramo_'
```

- `tramo_outbox_pending_events`: events committed and not yet handed to the queues, counted up to
  10,000.
- `tramo_outbox_lag_seconds`: age of the oldest of them, 0 when none waits. The publisher polls
  every `OUTBOX_POLL_INTERVAL_MS` (500 ms) and drains in batches of `OUTBOX_BATCH_SIZE`; after a
  failure it backs off, doubling up to 30 s. A lag that stays above 30 s, or keeps rising, means
  events are not reaching the queues: see [Outbox not draining](#outbox-not-draining).
- `tramo_queue_jobs{queue, state}`, state `waiting`, `active`, `delayed` or `failed`:
  - `delayed` holds jobs waiting for their next attempt: a provider outage shows here first.
  - `failed` holds jobs that ran out of attempts (or failed permanently). They are kept 30 days,
    so watch for an increase, not the level.
  - `{queue="dead-letter", state="waiting"}`: dead letters waiting for someone. Nothing consumes
    that queue; any value above 0 needs a look.
  - `waiting` rising while `active` stays at 0: the worker is not consuming.
- `tramo_http_request_duration_seconds{method, route, status}`: latency and 5xx by route template.
- A series missing from a scrape means its source could not be read within five seconds; the api
  logs `Queue metrics unavailable`, `Queue metrics timed out` or the same for the outbox. Redis
  being down shows this way: the queue series disappear while the HTTP and outbox ones remain.

## Outbox not draining

- **Symptom**: `tramo_outbox_lag_seconds` rising; nothing happens after a request (no email, an
  application stays `submitted`, a signed contract is never paid).
- **Check**:
  - `docker compose ps worker`: running and healthy? The publisher runs in the worker.
  - `pnpm queue:inspect`: the outbox line gives unpublished rows, the age of the oldest and how
    many carry an error, with the last error of the first five.
  - `docker compose logs worker | grep 'Outbox publish failed'`: the error and the next retry.
  - `curl -s localhost:3000/health/ready`: Redis or Postgres down?
- **Action**: fix the dependency or restart the worker (`docker compose restart worker`). The
  publisher resumes by itself. A batch whose jobs Redis does not accept within
  `OUTBOX_ENQUEUE_TIMEOUT_MS` is rolled back and sent again; job ids (`<eventId>.<consumer>`) and
  consumer idempotency absorb the duplicates. Published rows are never deleted: they are the
  history reporting rebuilds from (ADR 019).

## Jobs failing and the dead-letter queue

- **Symptom**: `failed` or dead-letter counts rising, `Job failed, will retry` (warn) or
  `Job moved to dead-letter queue` (error) in the worker logs, `deadLetters` above 0 in
  `GET /ops/overview`.
- **Check**:
  - `pnpm queue:inspect`: counts per queue, the outbox backlog and the latest dead letters.
  - `pnpm queue:inspect <queue>`: the latest failed jobs (`--limit N`).
  - `pnpm queue:inspect <queue> <jobId>`: state, attempts, error, stack, data and advice. An event
    job's id is `<eventId>.<consumer>`, which names the event and the consumer.
  - Bull Board at http://localhost:3000/admin/queues (basic auth, `ops` / `tramo-queues` in
    compose; not served without `BULL_BOARD_PASSWORD`).
- **How a job ends**: retried with backoff (default five attempts from 2 s; provider calls have
  their own schedule, below); once out of attempts it stays in its queue's failed set and a copy
  goes to `dead-letter`, kept until someone removes it.
- **Action**, only once the cause is fixed:
  - Retry the job in its own queue: `pnpm queue:inspect <queue> <jobId> --retry`, then remove its
    dead letter: `pnpm queue:inspect dead-letter <deadLetterId> --remove`.
  - If the effect is no longer wanted, `--remove` the job and its dead letter instead.
  - A retry is safe: an event consumer claims `<eventId, consumer>` in `shared.processed_events`
    in the same transaction as its effects, so an event already applied is skipped; work-queue
    jobs are keyed by what they act on and their aggregates ignore a repeated step.
- For some queues an endpoint is the right lever, not the job:

  | Queue                       | Job id                                              | After the job ran out                                              |
  | --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
  | `events.<module>`           | `<eventId>.<consumer>`                              | Retry the job                                                      |
  | `catalog.vat-checks`        | `<centerId>`                                        | `POST /centers/:id/verify-vat` (admin, ops)                        |
  | `origination.verifications` | `<applicationId>.<kyc\|employment\|bureau>`         | Retry the job                                                      |
  | `lending.signatures`        | `<contractId>.send`                                 | Retry the job                                                      |
  | `lending.disbursements`     | `<disbursementId>.<attempt>.<transfer\|settlement>` | `POST /ops/disbursements/:id/reconcile`                            |
  | `billing.collect`           | `<chargeId>.<attempt>.collect.<eventId>`            | `POST /charges/:id/retry`                                          |
  | `billing.psp-simulator`     | `<chargeId>.<attempt>.callback`                     | Retry the job once the worker reaches the api (`PSP_CALLBACK_URL`) |
  | `billing.cycle`, `.dunning` | scheduled                                           | `POST /ops/billing/run`, `POST /ops/dunning/run`                   |
  | `billing.cycle` (rebill)    | `<contractId>.rebill.<eventId>`                     | `POST /ops/billing/run?contractId=` (a payoff was withdrawn)       |
  | `notifications.emails`      | `<notificationId>.send`                             | None: a failed email is not sent again (see Emails)                |
  | `notifications.webhooks`    | `<deliveryId>.r<round>`                             | `POST /centers/:id/webhook-deliveries/:deliveryId/redeliver`       |
  | `reporting.rebuild`         | `reporting.rebuild`                                 | `POST /ops/reporting/rebuild` again                                |

## Application stuck in verification

- **Symptom**: an application stays `submitted`, `verifying` or `scoring`.
- **Check**:
  - `pnpm api:call GET '/applications?status=verifying' --as ops` (or `submitted`, `scoring`).
  - `pnpm trace <applicationId>`: the three jobs `<applicationId>.kyc`, `.employment` and
    `.bureau` on `origination.verifications`, and the `VerificationCompleted` events.
  - A job in `delayed` is retrying a provider outage: about two hours (nine attempts,
    exponential from 30 s) before it is dead-lettered.
  - All three answers recorded and still `scoring`: the `origination.score-application` consumer
    failed on `events.origination` (`pnpm queue:inspect events.origination`).
- **Action**: once the provider answers again, retry the dead job
  (`pnpm queue:inspect origination.verifications <applicationId>.<type> --retry`) or the scoring
  consumer's job, then remove the dead letter. Each provider answer is recorded once, so a retry
  never asks twice for the same answer. An application that does not move for 14 days expires
  (hourly sweep) and is final; the student applies again.
- **Not stuck**: `needs_review` waits for an analyst and never expires. Ops work it from
  `GET /ops/applications/review-queue` and decide with
  `POST /ops/applications/:applicationId/decide` (outcome and a reason).

## Disbursement failed

- **Symptom**: a signed contract is not `active`; `GET /ops/overview` shows transfers pending or
  failed.
- **Check**: `pnpm api:call GET '/ops/disbursements?status=failed' --as ops` (also `pending`,
  `sent`) gives the attempt and `failureReason`. An inactive center or one without a payout
  account fails the attempt before anything is sent; the bank's refusal fails a sent one (the
  simulated bank bounces an IBAN ending in `0000` as `account_closed`).
- **Action**:
  - `failed`: correct the cause (an admin changes the payout IBAN with
    `PATCH /centers/:id` and `payoutIban`), then `POST /ops/disbursements/:id/retry`. It is a new
    attempt with a new key, and the payout account is read again.
  - `pending` or `sent` whose jobs ran out (a long bank outage; settlement checks run for about a
    day and a half): `POST /ops/disbursements/:id/reconcile`. A pending attempt is sent again
    with its own key, so the bank never pays it twice; a sent one is checked with the bank.
    Nothing is failed blindly, since money may already be out.
  - Both are audited. A settled disbursement activates the contract and opens its plan.

## Charges failing and dunning

- **Symptom**: charges `failed` or `overdue`, a contract `in_arrears`, students not debited.
- **Check**:
  - `pnpm api:call GET '/contracts/<contractId>/charges' --as ops`: status, attempts and the last
    failure reason; `GET /contracts/:id/statement` for the ledger.
  - No mandate: charges stay `scheduled` and dunning chases them. Signing one
    (`POST /contracts/:id/mandate`, the student) collects at once what fell due meanwhile.
  - The simulated provider refuses amounts ending in 13 cents (`insufficient_funds`) and answers
    `SIMULATED_PSP_DELAY_MS` later through `billing.psp-simulator`, which posts to the api at
    `PSP_CALLBACK_URL`.
  - A charge stuck `pending`: the provider never answered (collection retried about two hours,
    then dead-lettered) or its callback did not reach the api. Dunning leaves pending charges
    alone.
  - Schedules (UTC): cycle on the 1st and the 5th at 03:00 (instalments of the month, then the
    ISA months whose declarations closed on the 4th), collection daily at 06:00, dunning daily at
    07:00, ISA declaration reminders on the 25th at 09:00. A run that could not bill or dun some items
    reports them and the scheduled job fails, so it shows in the queue and is retried.
- **Action**:
  - `POST /charges/:id/retry` (ops, admin): a `failed` or `overdue` charge gets a new attempt; a
    `pending` one is asked again with the same key (a new job), never collected twice. Refused
    when the contract is no longer being repaid (`contract_not_repaying`, e.g. defaulted) or has
    no mandate (`mandate_missing`).
  - Catch up a missed run with `POST /ops/billing/run?asOf=YYYY-MM-DD` (cycle, then collection;
    `&contractId=` for one contract) and `POST /ops/dunning/run?asOf=YYYY-MM-DD`. Both are safe to
    repeat: charges are unique per contract and reference, and each dunning step is applied once.
    A day still to come is refused (`as_of_in_future`, 422) unless `BILLING_FUTURE_RUNS_ENABLED`
    (on by default outside production).
  - Dunning steps by days from the due date: reminder at −3, notice at +1 (`overdue`), collection
    retried at +3 and +7, second notice at +15, arrears at +30 (contract `in_arrears`), write-off
    at +90 (contract `defaulted`, its plan closed as `defaulted`). After the default no retry is
    submitted, by dunning or ops; the other charges still get their notices and write-off. A
    payment that leaves nothing in arrears clears them.

## A center's webhook failing

- **Symptom**: a center reports missing events; deliveries `failed`.
- **Check**:
  - `pnpm api:call GET '/centers/<centerId>/webhook-deliveries?status=failed' --as ops`: each
    attempt with its status code or failure category (`http_503`, `timeout`,
    `connection_failed`, `dns_failed`, `target_unreachable`, `webhook_removed`).
  - `GET /centers/:id/webhook`: the URL and whether the subscription is `active` or `removed`.
  - In compose the sink stands in for the center: `curl -s http://localhost:9099/deliveries`.
- **How it behaves**: five attempts per round, the delay doubling from `WEBHOOK_RETRY_DELAY_MS`
  (30 s: about 7.5 minutes per round), then the delivery is `failed` and its job dead-lettered.
  Redirects are not followed (a 3xx is a failed attempt) and only the status is read.
- **SSRF rules**: where `WEBHOOK_PRIVATE_TARGETS_ENABLED` is off (the default in production,
  which refuses to start with it on) only https to public addresses is posted. Configuration
  refuses http and private literal addresses (`invalid_webhook_url`); at each connection the host
  is resolved and refused if any address is loopback, private, link-local, carrier-grade NAT,
  documentation, multicast, reserved or an IPv6 form carrying IPv4 (`target_unreachable`).
  Outside production it is on by default, which is how compose reaches the sink.
- **Action**: once the center's endpoint answers 2xx,
  `POST /centers/:id/webhook-deliveries/:deliveryId/redeliver` (center admin, ops, admin) starts a
  new round. It is refused with `webhook_delivery_in_progress` while a round is pending, unless
  the round has had no attempt for 15 minutes (its job was lost). Retrying the old job does
  nothing: a job of a finished round posts nothing.

## Emails not arriving

- **Symptom**: a student or center says an email never came.
- **Check**:
  - Mailpit at http://localhost:8025 holds every email the stack sends.
  - `pnpm trace <id the email is about>` (application, contract, charge...): the `notify` lines
    show the email written to `notifications.notification_log` with its status, the `mail` lines
    whether Mailpit has it.
  - No email written: the notifications consumer of the event failed
    (`pnpm queue:inspect events.notifications`). Only the events in the table of
    [`architecture.md`](architecture.md#notifications) send email.
  - Written and `pending`: its job is retrying, five attempts over about five minutes
    (`pnpm queue:inspect notifications.emails <notificationId>.send`); is `mailpit` up?
  - Written and `failed`: the SMTP server refused it or the job ran out; `last_error` is a
    category (`smtp_550`, `timeout`, `connection_failed`).
- **Action**: fix the SMTP side (`docker compose up -d mailpit`). An email still pending a day
  after it was written is abandoned by the hourly sweep (at minute 15) instead of being sent
  late. A `failed` email is never sent again, and retrying its job sends nothing; no endpoint
  resends one. Sending is at least once: a reply lost after the server took the message can
  produce a duplicate.

## Reporting figures wrong

- **Symptom**: a dashboard (`GET /centers/:id/dashboard`, `GET /ops/overview`) disagrees with the
  contracts or charges.
- **Check**: `pnpm queue:inspect events.reporting` for failed projections; retry them once fixed.
  Facts are upserts that converge whatever the order of events, so retried events land correctly.
- **Action**: after a projector fix, on a database that had activity before reporting existed, or
  when facts are suspect: `pnpm api:call POST /ops/reporting/rebuild --as ops`. It answers
  `{"queued": true}`, or `false` when a rebuild is already queued or running (one at a time; the
  request joins it). The job deletes the facts and replays the outbox in one REPEATABLE READ
  transaction: dashboards show the old figures until it commits, and live projections wait for it
  holding worker connections, so run it when the stack is quiet. The worker logs
  `Reporting read models rebuilt` with the number of events applied.

## Migrations

- `pnpm migration:show` lists applied and pending migrations; `pnpm migration:run` applies the
  pending ones; `pnpm migration:revert` undoes the last applied one. Each builds first and uses
  `DATABASE_URL` from `.env`.
- In compose the api applies pending migrations at startup, each in its own transaction, holding
  a Postgres advisory lock (ADR 013): replicas starting together wait, then find nothing pending.
  A migration that fails stops the api from becoming healthy, and the worker and seed wait for
  it: read `docker compose logs api`.
- A revert on the compose database is undone at the api's next start, which applies pending
  migrations again.
- Never edit a migration that has been applied (or reached `main`); write a new one. New ones are
  verified with `pnpm migration:verify check`, which runs, reverts and runs them again comparing
  schema dumps. `synchronize` and `schema:sync` are never used.

## Secret rotation

- **`ESIGN_WEBHOOK_SECRET`**: set the new value and put the old one in
  `ESIGN_WEBHOOK_PREVIOUS_SECRET` (both 32+ characters), restart the api, move the provider to the
  new secret, then clear the previous one and restart again. While both are set, callbacks signed
  with either are accepted; signatures older than five minutes are refused either way.
- **`PSP_WEBHOOK_SECRET`**: the same with `PSP_WEBHOOK_PREVIOUS_SECRET`. Restart the worker too:
  the simulated provider signs its callbacks there with the current secret.
- In compose, the `*_PREVIOUS_SECRET` variables are not in the `x-app` environment of
  `docker-compose.yml`; a rotation there needs them added to it.
- **`JWT_ACCESS_SECRET`**: rotated by redeploying; access tokens signed with the old one stop
  working (they live 15 minutes) and clients refresh. Refresh tokens are opaque and unaffected.
- **`METRICS_TOKEN`, `BULL_BOARD_PASSWORD`**: change and restart the api.
- **Center webhook secrets**: configuring the webhook again (`PUT /centers/:id/webhook`, center
  admin) generates a new secret, returned once; deliveries are signed with it from then on.
- **`FIELD_ENCRYPTION_KEY`**: the process reads one key and has no previous-key variable.
  Changing it on a database with data makes every encrypted value unreadable (payout and creditor
  IBANs, mandate IBANs, webhook secrets, national ids fail with `FieldDecryptionError`). ADR 014
  records that the versioned ciphertext prefix allows a key change later: decrypt every known
  version, write only the newest, re-encrypt old rows in a background job, then stop reading the
  old version. That procedure is not implemented.

## Production configuration refusals

With `NODE_ENV=production` a process refuses to start, naming each problem, when:

- a secret still has the value published in `.env.example` or `docker-compose.yml`:
  `JWT_ACCESS_SECRET`, `ESIGN_WEBHOOK_SECRET` or `PSP_WEBHOOK_SECRET` containing `change-me`,
  `BULL_BOARD_PASSWORD=tramo-queues`, `METRICS_TOKEN=tramo-local-metrics-token-change-me`, or the development
  `FIELD_ENCRYPTION_KEY`;
- `WEBHOOK_PRIVATE_TARGETS_ENABLED=true`;
- `SMTP_HOST` is `localhost` or `mailpit`, or `EMAIL_FROM` is an `@tramo.test` address;
- `VIES_MODE` is not `live`;
- `VERIFICATION_PROVIDERS`, `LENDING_PROVIDERS` or `PAYMENT_PROVIDER` is `simulated`. Only
  simulated providers exist, so no production process starts until real ones replace them.

Every environment also fails fast on an invalid or missing variable (zod, with its name):
`JWT_ACCESS_SECRET` and the webhook secrets need 32+ characters, `FIELD_ENCRYPTION_KEY` 32 bytes
in base64, `METRICS_TOKEN` 32+ and `BULL_BOARD_PASSWORD` 8+. Production also turns off Swagger,
future billing runs and private webhook targets by default. The compose stack runs with
`NODE_ENV=development`.

## Rate limiting and account lockout

- **Per client**: `THROTTLE_LIMIT` (120) requests per `THROTTLE_TTL_MS` (60 s) per client and
  route, counted in Redis so every api instance shares the counters. A client is an IPv4 address
  or an IPv6 /64; behind proxies set `TRUST_PROXY_HOPS`. Health checks and `/metrics` are exempt.
- **Credential routes** (`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, and
  `POST /applications`): `THROTTLE_AUTH_LIMIT` (10) per minute per client on top.
- What the caller sees: 429 with `Retry-After` and Problem Details code `too_many_requests`.
- **Lockout**, per account whatever the client: the fifth failed sign-in in a row locks it for
  `LOGIN_LOCK_BASE_SECONDS` (60 s); each further failure after a lock doubles it (120 s, 240 s...)
  up to `LOGIN_LOCK_MAX_SECONDS` (one hour). Failures are forgotten a day after the last one and
  a successful sign-in clears them. While locked, sign-in answers 429
  `account_temporarily_locked` with `Retry-After` and "Try again in N seconds", even with the
  right password. No endpoint unlocks an account; the lock expires. Anyone can lock an account by
  failing on purpose; the attempts are in the logs.
- **Bull Board**: ten failed sign-ins from one client within 15 minutes refuse every attempt from
  it (429 with `Retry-After`) until the window ends.
- In compose these variables are not passed to the containers, so the defaults above apply.
