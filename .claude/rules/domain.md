---
paths:
  - 'src/modules/*/domain/**'
  - 'src/shared/domain/**'
---

# Domain code

- Plain TypeScript only. No imports from `@nestjs/*`, `typeorm`, `ioredis`, `bullmq`, or any
  `application`/`infrastructure` folder; `pnpm arch:check` enforces it.
- No `new Date()` or `Date.now()`: take `now: Date` as an argument, supplied by the handler from the
  `Clock` port. ESLint rejects both in domain folders.
- Invariants live in the aggregate. Construct through a named factory (`User.register`,
  `ApiKey.issue`) that validates, and `reconstitute` for loading without re-validation or events.
- State transitions go through one method per transition that checks the current state and throws a
  typed error; never assign the status from outside.
- Errors are `DomainError` subclasses with a category (`validation`, `not_found`, `conflict`,
  `rule_violation`, ...) and a stable `code`; the HTTP layer maps categories to status codes.
  Expected outcomes the caller branches on can be a `Result` instead of an exception.
- Money is `Money` (integer cents, `decimal.js` for arithmetic, half-up rounding); rates are
  `Percentage` (basis points). A bare `number` never represents money or a rate.
- Events are facts in the past tense (`StudentRegistered`, `ApiKeyRevoked`), recorded with
  `this.record(...)` inside the transition that caused them. Payloads carry ids and values, not
  aggregates, and never secrets or password hashes.
- Ports the domain needs (repositories) are interfaces plus an injection `Symbol` in
  `domain/ports`; export the public surface from `domain/index.ts`.
- Unit tests next to the code (`*.spec.ts`), plain Jest without `@nestjs/testing`.
