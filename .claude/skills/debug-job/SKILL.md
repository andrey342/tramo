---
name: debug-job
description: Diagnose stuck or failing background work - queue counts, failed jobs with attempts and stack traces, the outbox backlog and the dead-letter queue - and propose retry, discard or a fix. Use when an effect did not happen (no email, projection not updated) or Bull Board shows failures.
argument-hint: '[queue] [jobId]'
allowed-tools: Bash(pnpm queue:inspect*), Bash(docker compose ps*), Bash(docker compose logs*), Read, Grep
---

# Debug a job

Arguments: `$ARGUMENTS`. Works against the compose stack (`REDIS_URL`, `DATABASE_URL` in `.env`).

1. Overview: `pnpm queue:inspect`. Per queue: waiting, active, delayed, failed, completed. Then
   the outbox (unpublished rows, age of the oldest, rows with errors) and the latest dead letters
   with their ids.
   - unpublished rows growing: the worker's publisher is down or Redis is unreachable
     (`docker compose ps worker`, `docker compose logs worker`);
   - failures in `events.<module>`: go to step 2.
2. One queue: `pnpm queue:inspect <queue>` lists the latest failed jobs (`--limit N`).
3. One job: `pnpm queue:inspect <queue> <jobId>`: state, attempts, error, stack, data and logs,
   and advice. Job ids are `<eventId>.<consumer>`, so the event and the consumer are in the id.
   Dead letters live in the `dead-letter` queue with their own ids (shown in the overview).
4. Decide with the user before acting, then:
   - transient cause fixed: `--retry` (consumers are idempotent, a retry cannot apply twice);
   - permanent cause: fix the code or data first; or discard with `--remove`, and remove its dead
     letter too (`pnpm queue:inspect dead-letter <id> --remove`).
5. Read the consumer named in the job (`src/modules/<module>/**`, `@EventSubscriber`) when the
   error comes from it, and report: what failed, why, what was done, what remains.
