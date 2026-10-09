# 009. Time comes from an injectable Clock

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Billing cycles run on the first of the month, dunning escalates at D+1, D+3, D+30 and D+90,
applications expire after 14 days and ISA plans end eight years after the program. Code that
calls `new Date()` directly can only be tested by waiting or by patching globals, and the demo
cannot show a contract's life in a few minutes.

## Decision outcome

`Clock` is a domain port (`now(): Date`). Production uses a system clock; tests use `FixedClock`,
which can be set and advanced. Aggregates receive the current time as an argument
(`application.submit(clock.now())`), so domain methods stay pure and the handler is the only
place that reads the clock.

Jobs that depend on the date (`billing.cycle`, `billing.dunning`) take an optional `asOf` date.
The ops endpoints `POST /ops/billing/run?asOf=` and `POST /ops/dunning/run?asOf=` pass it
through, which lets the demo fast-forward a contract without changing the system time.

### Consequences

- Good: time-dependent rules are tested at exact boundaries (D+29 vs D+30) without fake timers.
- Good: the demo and support staff can replay a run for a past or future date.
- Good: an ESLint rule rejects `new Date()` and `Date.now()` in domain code, so the rule does not
  depend on review.
- Bad: one more constructor argument in handlers and services that need time.
