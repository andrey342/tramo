# 006. RFC 9457 Problem Details for every error response

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Clients include training centers integrating through API keys. They need one error format they
can parse without special cases per endpoint, and field-level detail for validation failures.

## Considered options

1. Nest's default error body (`{ statusCode, message, error }`).
2. A custom envelope.
3. RFC 9457 Problem Details (`application/problem+json`).

## Decision outcome

Option 3, implemented as a global exception filter.

- `type`: `about:blank` for plain HTTP errors, where the status code says everything; otherwise a
  URN `urn:tramo:problem:<slug>`. URNs identify the problem without implying a documentation page
  that clients would try to fetch; the catalogue of types is documented in OpenAPI.
- `title`, `status`, `detail`, `instance` (request path) as defined by the RFC.
- Extensions: `code` (stable, snake_case, for programmatic handling), `requestId` (correlates
  with logs) and `errors[]` (`{ field, message }`, nested fields as dotted paths) for validation.
- Unknown errors become a generic 500. The stack trace and message only go to the log.

### Consequences

- Good: one schema to document and to assert in tests; a standard media type that client
  libraries recognise.
- Good: domain errors map to types and codes in one place instead of ad hoc `HttpException`s.
- Bad: Nest's built-in exceptions must be translated; the filter owns that mapping.
