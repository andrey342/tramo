---
paths:
  - 'test/**'
  - 'src/**/*.spec.ts'
  - 'src/**/*.int-spec.ts'
---

# Tests

- Three levels, chosen by file name: `*.spec.ts` unit (no I/O), `*.int-spec.ts` integration
  against Testcontainers Postgres and Redis, `test/e2e/*.e2e-spec.ts` through HTTP with supertest.
- Domain tests use plain Jest, no `@nestjs/testing`. Handler tests build the handler by hand with
  the in-memory fakes from `test/fakes` and a `FixedClock`.
- Build data with the factories in `test/factories` (unique emails, UUIDv7 ids); never share rows
  between tests or depend on execution order.
- Integration tests use the real migrations (global setup runs them). Never SQLite, never a mocked
  `Repository` or `DataSource`.
- Every port with a real adapter and a fake has one contract suite in `test/contracts` that both
  run (`loginAttemptTrackerContract` is the pattern).
- Names read as behaviour: `should <do something> when <condition>`.
- Asynchronous effects (outbox, queues) are awaited with `eventually(...)`, not fixed sleeps.
- Assert on Problem Details `code`, not on message text.
