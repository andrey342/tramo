# 016. French amortisation with per-row rounding and calendar-month ISA periods

- Status: accepted
- Date: 2026-10-12

## Context and problem statement

A signed contract becomes a repayment plan: a table of monthly instalments, or an income share
agreement (ISA) charged month by month from what the graduate earns. The table is what the
student signs and what billing will charge, so every cent of it must be reproducible; the ISA
rules (threshold, cap, maximum payments, window) decide what a month costs. Interest on cents
does not divide evenly, and months have different lengths. Where does the rounding go, when do
instalments fall due, and what is an ISA "month"?

## Decision drivers

- The principals of the table add up to the principal exactly; nobody pays a cent more or less.
- The instalment the student was offered (origination) is the one charged (lending).
- The table is fixed when the contract is activated: a later code change cannot move a cent.
- Simple enough to state in the contract text and to test against tables computed by hand.

## Considered options

1. Exact interest per day (actual/365) on the balance between due dates, so each instalment
   differs a little.
2. A constant instalment `A = P·i / (1 − (1 + i)^−n)`, `i = TIN / 12`, with the interest of
   each row rounded half-up and the rounding left to accumulate, absorbed by the last row.
3. Option 2 but rounding only the instalment and computing interest with full precision,
   rounding the table once at the end.

## Decision outcome

Option 2, the convention of Spanish consumer loans. The shared kernel computes `A` and the TAE
(`(1 + i)^12 − 1`, to the basis point, no fees: the student pays none) for both origination's
offer and lending's table. Each row's interest is the balance times `i`, half-up to the cent; its
principal is `A` minus that interest; the last row repays whatever balance is left, so it can
differ from `A` by a few cents. The table is stored with the plan (`lending.financing_plans`,
jsonb), not recomputed.

Instalments fall due on the day of the month the contract was activated (the day the center was
paid), from the next month on; days 29 to 31 move to the 28th so every month has the day. The
first period therefore always lasts one month. A payoff is the overdue instalments, the principal
of the ones not yet due and the interest accrued since the last due date, pro rata of the days of
the current period, half-up.

An ISA counts calendar months. The course is taken to start on activation and last its
duration; payments start with the first full month after the grace period (the month the grace
ends in, when it ends on the 1st), and the obligation lapses eight years after the end of the
course. The student declares a month's income from its first day until the end of the 4th of the
next month, since salaries are often paid on the last days of a month or the first of the next; on
the 5th the month is assessed and its charge falls due. Each month is assessed once, in order and
without gaps: at or above the threshold the student pays the share of the income declared, never
past the cap; below it, or without a declaration, the month is paused and owes nothing; two months
in a row without a declaration mark the plan overdue: the student is told, and staff see it on the
schedule. No month is assessed after the cap, the last payment, or once a month starts after the
window; the plan ends when every month charged has been collected, so arrears and default still
apply to what the student owes until then. Amounts count towards the cap when they are charged.

Option 1 is fairer to the day but gives a different instalment each month, which the offer cannot
state as one figure. Option 3 produces rows whose interest and principal do not add up to the
amount shown.

### Consequences

- Good: the tables in the tests were computed by hand, row by row, and the specs check them to the
  cent, including the sum of principals over terms from 6 to 48 months and odd amounts.
- Good: what is offered, signed and charged is the same number, from the same function.
- Bad: the first instalment charges a full month of interest whatever the day of activation, and
  the 29th-31st rule shortens one period by up to three days. Accepted for a product with no fees;
  a regulator-grade product would add broken-period interest.
- Bad: assuming the course starts on activation can move an ISA's first payment by weeks if the
  student starts later. The start date is not captured by origination today; when it is, the plan
  can take it instead.
- Good: a salary paid on the 1st or 2nd is declared in time. The declaration window closes on a
  fixed day, not when a job happens to run: a declaration on the 5th is refused even if the
  cycle has not assessed the month yet.
- Bad: an ISA charge is created on the day it falls due, so no reminder precedes it as one does
  an instalment; the student knows the amount from the declaration they made days before.
- Bad: amounts count towards the cap when charged, not when collected. A charge is only written
  off with the default of the contract, after which the plan is no longer billed, so the cap is
  never given back.
