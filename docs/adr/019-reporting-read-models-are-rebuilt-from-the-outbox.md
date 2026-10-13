# 019. Reporting read models are rebuilt from the outbox

- Status: accepted
- Date: 2026-10-13

## Context and problem statement

Centers want their portfolio at a glance (the funnel of applications, contracts by state and
product, money disbursed, collected and owed, the share in arrears), program owners want to
know how a program converts, and operations want the morning's to-do list. The facts live in
three modules (origination, lending, billing), each in its own schema, and no module may read
another's tables (ADR 008). Read models must also be
rebuildable from scratch: a projection bug is then fixed by fixing the code and rebuilding. Where does reporting get
its facts, and what does a rebuild replay?

## Decision drivers

- Read models must not couple reporting to the other modules' tables or aggregates.
- A rebuild must reproduce exactly what the live consumers built, with the same code.
- Events may arrive out of order (one job per consumer and event) and more than once.
- A credit score is personal financial data: origination keeps it in the decision record and its
  events say only the outcome.

## Considered options

1. Rebuild by asking each module for its current state through public queries.
2. Rebuild by replaying the event history, kept in the outbox, through the same projector the
   consumers use.
3. Keep a separate event store for reporting, written by its consumers.

## Decision outcome

Option 2. The outbox already keeps every event after publishing it, in id (time) order; a
shared `EventHistory` port reads it (meant for projections only: payloads hold what each module
published, an email included). Reporting keeps one fact per application, contract,
disbursement and charge (`reporting.*_facts`), written by upserts that give the same facts
whatever the order and repetition of events: descriptive fields are the same in every event that
carries them; the status follows the most recent event (by time, then event id) but a final
status is never replaced by one that is not (lending keeps an ended contract ended); an
application's decision is set once; a charge keeps the day of its latest failure. The consumers
and the rebuild call the same `ReportingProjector`. `POST /ops/reporting/rebuild` queues a job
that, in one REPEATABLE READ transaction, locks the facts in EXCLUSIVE mode (writers wait,
readers do not), deletes them and replays the history: dashboards answer with the old figures
until it commits, and live consumers then apply their event on top. Figures are computed from
the facts when asked, by pure functions of the domain over grouped rows.

Option 1 would need a query per module and per kind of fact only for the rebuild, a second path
that could drift from the consumers. Option 3 duplicates the outbox.

The mean score of a program's applicants is not projected: putting scores in events would
publish personal financial data to every consumer and job. Origination answers it as an
aggregate (`GetProgramScoresQuery`), only from ten scored applicants and in bands of five, so
no applicant's score can be read from it. Two readings either side of a new decision still say
roughly whether that applicant scored above or below the mean, which tells the center little
more than the decision it already sees.

### Consequences

- Good: a projection bug is fixed by fixing the projector and rebuilding; no backfill script.
- Good: reporting depends only on the published event payloads, the modules' public contract.
- Bad: the outbox is never pruned while reporting replays it; at volume it grows without bound.
  An archive of published events (a partitioned table, or a copy to object storage) would keep
  the history without slowing the publisher's scans, which only read unpublished rows.
- Bad: a rebuild holds one transaction for the whole history, and live consumers wait for it,
  each holding a database connection: up to five of the worker's pool while it lasts, which slows
  its other queues. At volume it would replay into shadow tables and swap them.
- Bad: events published before reporting existed reach no consumer: a deployment that adds
  reporting to existing data runs one rebuild.
- Bad: figures are aggregated per request; a large portfolio would want summary tables updated by
  the same projector.
