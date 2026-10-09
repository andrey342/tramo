# 004. Transactional outbox, BullMQ delivery, idempotent consumers

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Most workflows cross modules: a submitted application starts three verifications, a signed
contract triggers a disbursement, a failed charge starts dunning and notifies the center. If an
aggregate is saved and the event is then published to a broker as a separate step, a crash in
between loses the event (or, in the other order, publishes an event for a change that was rolled
back). Distributed transactions between Postgres and Redis are not an option.

## Decision outcome

- **Outbox.** Repositories hand the aggregate's pending events to the `EventBus` port inside the
  unit of work. The implementation inserts them into `shared.outbox_messages` in the same
  transaction as the state change, and refuses to run outside one.
- **Publisher.** The worker polls the outbox (`OUTBOX_POLL_INTERVAL_MS`, drains in batches of
  `OUTBOX_BATCH_SIZE`), claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`, adds one BullMQ job
  per subscriber and marks the rows published in the same transaction. Several workers can run the
  publisher concurrently. On Redis or Postgres errors it backs off exponentially up to 30 s and
  records `attempts` and `last_error` on the rows.
- **Fan-out at publish time.** Consumers declare `@EventSubscriber({ event, consumer })`. Each
  consumer gets its own job in the queue of its module (`events.<module>`), with job id
  `<eventId>.<consumer>`, so a slow or failing consumer never blocks another one.
- **At least once in, exactly once effects.** A crash after enqueueing but before the commit
  republishes rows; BullMQ retries failed jobs (5 attempts, exponential backoff). Consumers claim
  `(eventId, consumer)` in `shared.processed_events` inside the same transaction as their effects,
  so duplicates are skipped and a failed attempt releases its claim.
- **Dead letters.** After the last attempt, or on an `UnrecoverableError`, the job is copied to the
  `dead-letter` queue with the original queue, payload, reason and attempts. Bull Board
  (`/admin/queues`, basic auth) shows every queue, including the dead letters, and can retry jobs.
- **Correlation.** Outbox rows store the request id; jobs carry it as `correlationId` and
  processors run in a CLS context with that id, so one id follows a request through every job and
  log line it causes.

Ordering is per consumer and best effort: events of one aggregate are published in id (time)
order, but retries can reorder deliveries. Consumers must tolerate that, typically by checking the
aggregate state they act on.

### Consequences

- Good: no lost or phantom events; consistency without two-phase commit.
- Good: queues are per module, observable in Bull Board and replayable from the dead-letter queue.
- Bad: delivery latency of up to one poll interval (500 ms by default) after an idle period.
- Bad: two stores to operate (Postgres for the outbox, Redis for the queues), and every consumer has
  to be written for redelivery.

### Rejected options

- Publishing to BullMQ directly from handlers: simpler, loses events on crashes.
- Postgres `LISTEN/NOTIFY` as the transport: no retries, no persistence while consumers are down.
- A broker such as Kafka or RabbitMQ: more guarantees and features than this volume needs, and one
  more system to run locally and in CI.
