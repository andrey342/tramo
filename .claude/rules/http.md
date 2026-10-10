---
paths:
  - 'src/modules/*/infrastructure/http/**'
  - 'src/shared/infrastructure/http/**'
---

# HTTP layer

- Controllers do three things: take a validated DTO, send a command or query through
  `CommandBus`/`QueryBus`, map the result to a response DTO. No business rules, no repositories.
- Request DTOs use `class-validator` and `@ApiProperty`; the global pipe runs with `whitelist` and
  `forbidNonWhitelisted`, so unknown fields are a 400. Response DTOs are explicit classes, never
  aggregates or ORM entities.
- Routes are authenticated by default. Mark open routes `@Public()`; restrict with `@Roles(...)` for
  users and `@RequireScopes(...)` for API keys. Read the caller with `@CurrentPrincipal()`, never
  `req.user`.
- Errors: throw a `DomainError` from the domain or application layer, or `ProblemException` for
  HTTP-only cases. Never `throw new HttpException(...)`; the filter renders Problem Details
  (`urn:tramo:problem:<code>`).
- `@Idempotent()` is mandatory on POSTs that create applications, contracts, disbursements, charges
  or anything else that moves money. Clients send `Idempotency-Key`.
- `@Audited({ action, resource })` on endpoints that change access, money or decisions.
- Lists are cursor-paginated (`CursorPageQueryDto`, keyset on `(created_at, id)`), never offset.
  A list bounded by design (a center's API keys) may skip it; say why next to the query.
- Paths are plural nouns under `/api/v1`; ids are UUIDv7 validated with `ParseUUIDPipe`.
- Document every status a route can return: errors with `@ApiProblems(400, 401, ...)`, success
  with `@ApiOkResponse`/`@ApiCreatedResponse`/`@ApiNoContentResponse` (declaring any response
  turns off the success response Swagger would otherwise infer).
