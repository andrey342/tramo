# 017. Billing applies lending's ISA rules through a public command

- Status: accepted
- Date: 2026-10-12

## Context and problem statement

The monthly cycle belongs to billing: it creates charges, collects them and duns what is not
paid. What an income share agreement charges for a month is a rule of the plan, which belongs to
lending: the share of the income declared, nothing below the threshold, never past the cap, a
month without a declaration paused, the plan ending at the cap, the last payment or the window
(ADR 016). Every month assessed changes the plan's running totals. How does billing get the
amount to charge without owning lending's rules or reading its tables, and without the plan and
the charge disagreeing after a failure?

## Decision drivers

- Modules talk only through `application/dto` and domain events (ADR 001, 008).
- The plan's totals and the charge for the same month change together or not at all: a charge
  without its assessment would be charged again next month; an assessment without its charge
  would never be collected.
- The ISA rules are tested once, in lending's domain.

## Considered options

1. Billing owns the ISA rules and the totals, and lending only keeps the instalment table.
2. Events both ways: billing publishes the income declared, lending assesses the month and
   publishes the amount, billing creates the charge.
3. Lending exposes a public command, `AssessIsaPeriodCommand` in its `application/dto`, that
   assesses one month on the income billing hands it and returns the outcome; billing calls it
   through the command bus inside its own unit of work and creates the charge in the same
   transaction.

## Decision outcome

Option 3. The cycle walks the plans being repaid through `ListBillablePlansQuery` and, for an
ISA, each month that has ended and lending has not assessed yet, in order: the declaration of the
month (or none), `AssessIsaPeriodCommand`, and the charge when there is one. Lending's handler
joins the transaction billing opened (nested units of work join the outer one), so the plan and
the charge are committed together, one plan per transaction. The reverse direction stays on
events: lending follows `ChargePaid`, `ContractInArrears`, `ArrearsCleared` and `ChargeWrittenOff`.

Option 1 splits the plan across two modules: the cap and the payments counted would live in
billing while lending answers "is this plan over?". Option 2 is eventually consistent where it
hurts most: between the two events a second cycle run would assess the month again, and a lost
event leaves the month assessed and never charged.

### Consequences

- Good: one transaction per plan and month; a failure rolls back both sides and the next run
  retries (the cycle reports the plans it could not bill).
- Good: the ISA rules are lending's alone, with their tests.
- Bad: a synchronous call between modules couples their availability: billing cannot assess an
  ISA month while lending's handler is broken. Inside one process that is the same deployment;
  extracting either module would turn the command into a request with an idempotency key (the
  month), which the plan already enforces (a month is assessed once, in order).
- Bad: a public command is a wider surface than the queries other modules expose. It is the only
  one, and it takes no actor: it is called from billing's jobs and ops runs, never from HTTP.
