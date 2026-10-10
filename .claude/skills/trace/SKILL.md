---
name: trace
description: Follow one aggregate (application, contract, user...) end to end - outbox events, the queue jobs they fanned out to, consumers that applied them, dead letters, audit entries, emails in Mailpit and webhook deliveries - as one timeline that points at the first broken link. Use when "X should have happened after Y" did not.
argument-hint: <aggregateId>
allowed-tools: Bash(pnpm trace*), Bash(pnpm queue:inspect*), Bash(docker compose ps*), Bash(docker compose logs*), Read, Grep
---

# Trace an aggregate

Arguments: `$ARGUMENTS` (the id of the aggregate, e.g. the `userId` a registration returned).

1. `pnpm trace <id>` prints, in time order:
   - `event`: outbox events of the aggregate, and of other aggregates whose payload names it;
   - `outbox`: when each was published, or that it was not (with the last error);
   - `job`: the jobs each event fanned out to (`events.<module>`, job id `<eventId>.<consumer>`),
     their state and error, and any copy in the dead-letter queue;
   - `consumer`: consumers that recorded the event as applied (`shared.processed_events`);
   - `audit`: audited actions on it (who, outcome, error code, request id);
   - `mail`: messages in Mailpit that mention it; `webhook`: deliveries the sink received.
     Lines marked `!!` are broken; the last line names the first one and the command to dig in.
2. Follow the hint: an unpublished event points at the worker or Redis
   (`docker compose ps`, `docker compose logs worker`); a failed job at
   `pnpm queue:inspect <queue> <jobId>` (the `debug-job` skill); an audit entry with a request id
   at `docker compose logs api | grep <requestId>`.
3. Report the timeline, the broken link and its cause. When a new event type, consumer, email or
   webhook is added to a module, check that it shows up here; extend `scripts/trace-aggregate.ts`
   if it lands somewhere the script does not look yet.
