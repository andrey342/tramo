# 005. Money as integer cents, rates as basis points

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

Tramo computes amortisation tables, platform fees, income-share charges and payoff quotes. A
one-cent error in a schedule is a real customer complaint and an accounting mismatch.
JavaScript numbers are binary floating point (`0.1 + 0.2 !== 0.3`).

## Decision outcome

- `Money` stores an integer number of cents plus a currency. Addition, subtraction, comparison
  and allocation are integer operations. A row's amount is an `integer` column (up to 21 million
  euros, which `pg` reads back as a number); sums that can grow past that, such as the reporting
  facts, are `bigint`. Both carry `CHECK (... >= 0)` where negative values make no sense.
- Multiplying by a rate goes through `decimal.js` and rounds back to the cent explicitly. The
  default is half-up, the common commercial rule; callers can choose `down` or `up` where a rule
  requires it.
- `Percentage` stores integer basis points (7.5 % = 750). Rates and shares map to integer columns
  and convert to an exact `Decimal` for calculations.
- Rounding is never implicit. Where rounding leaves a remainder (instalments, splits), the rule
  that absorbs it is part of the domain and tested (for example, the last instalment absorbs the
  difference so the principal adds up exactly).
- The API exposes amounts as integer cents in fields named `*Cents` (`"priceCents": 750000` is
  7,500.00 EUR) and rates as integer basis points in fields named `*BasisPoints`, never as floats.
  Every amount is in euros, the only currency Tramo lends in, so no currency field is sent.

### Consequences

- Good: sums and comparisons are exact; schedules reconcile to the cent.
- Good: rounding decisions are visible in code and covered by tests.
- Bad: clients divide by 100 to show an amount; the field names say so, and OpenAPI examples
  are in cents.
- Bad: interest calculations need `decimal.js`, which is slower than floats. The volumes here
  (a few hundred rows per schedule) make that irrelevant.

### Rejected options

- Floats: wrong results that only show up in production totals.
- `numeric` columns mapped to strings and decimal arithmetic everywhere: exact, but every
  comparison and sum becomes a library call and the type system no longer tells an amount from a
  rate.
