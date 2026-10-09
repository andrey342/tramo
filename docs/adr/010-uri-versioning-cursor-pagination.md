# 010. URI versioning and cursor pagination

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Training centers integrate their admission systems with the API and upgrade on their own
schedule. Lists (programs, applications, charges) grow without bound and are read while new rows
are being inserted.

## Decision outcome

- Versioning by URI (`/api/v1/...`) through Nest's URI versioning with `defaultVersion: '1'`.
  Infrastructure endpoints (`/health/*`, `/docs`, `/metrics`) are version neutral and live outside
  the `/api` prefix. A breaking change ships as `/api/v2` for the affected controllers only.
- List endpoints return `{ data: [...], nextCursor: string | null }`. The cursor is opaque
  (base64url of the last row's sort key and id), ordering is always stable (`created_at, id`) and
  every cursor column is indexed. Timestamp cursor columns are `timestamptz(3)`: the cursor goes
  through a JavaScript `Date`, and microsecond values would be truncated and skip rows.

### Rejected options

- Header or media-type versioning: cleaner URLs, but harder to try from a browser, curl or a
  partner's logs, and easy to forget in integrations.
- Offset pagination: simple, but pages shift when rows are inserted and `OFFSET` scans grow with
  the page number.

### Consequences

- Good: the version is visible in every log line and support conversation.
- Good: pages are stable under concurrent inserts and cost the same at any depth.
- Bad: no "jump to page N"; clients that need totals get them from dedicated summary endpoints.
