---
name: try-endpoint
description: Call an endpoint of the running stack as a demo user (student, center, ops, admin) or with an API key, with an Idempotency-Key on POSTs, and show status, key headers and a readable body or Problem Details. Use to check an endpoint by hand after changing it, or to reproduce a bug report.
argument-hint: <METHOD> <path> [json body] [--as student|center|ops|admin]
allowed-tools: Bash(pnpm api:call*), Bash(docker compose ps*), Bash(docker compose logs*), Read
---

# Try an endpoint

Arguments: `$ARGUMENTS`. Needs the stack up (`docker compose up -d --build --wait` after code
changes, so the api runs the current build).

1. `pnpm api:call <METHOD> <path> [body] [--as <role>]`
   - `path` without prefix goes under `/api/v1` (`/me`, `centers/<id>/api-keys`); `/health/*` and
     `/docs` are used as given. In Git Bash both `/me` and `me` work.
   - `body` is JSON or `@file.json`.
   - Signs in as the demo account of the role (`scripts/demo-users.ts`; default `student`, who is
     registered on first use; the other roles need the demo seed, which is not in the repo yet). Tokens are cached and refreshed
     in `.local/`. Use `--anonymous` for public routes or `--api-key <key>` for center keys.
   - POSTs get a fresh `Idempotency-Key`; pass `--idempotency-key <key>` to send the same key
     again and see the replay (`idempotent-replayed: true`).
   - `{{last.<field>}}` in the path or body takes that field from the previous successful
     response, to chain calls: create something, then `GET /things/{{last.id}}`.
2. Read the output: status and timing, `location`, `retry-after`, `x-request-id`, then the body.
   Problem Details are printed as code, title, detail, request id and field errors.
3. For a 5xx, find the request in the logs with its id: `docker compose logs api | grep <id>`.
