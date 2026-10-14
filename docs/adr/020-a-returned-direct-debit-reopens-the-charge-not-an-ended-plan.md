# 020. A returned direct debit reopens the charge, not an ended plan

- Status: accepted
- Date: 2026-10-13

## Context and problem statement

A SEPA Core debit the provider reported collected is not final: the debtor's bank can send it
back, without a reason for 8 weeks and for 13 months when the debit was unauthorised (codes such
as `MD06` refund asked by the debtor, `AM04` insufficient funds, `MD01` no mandate). Billing
recorded `paid` as the end of a charge and lending marked the instalment paid, perhaps the last
one, ending the plan (`repaid`) and the contract (`completed`), or settled a payoff. When the
money comes back, the student owes it again. Where does the debt go, how is it chased, and what
happens to a plan that ended because of that payment?

## Decision drivers

- The statement and the dashboards show what is owed: a returned payment is owed again.
- Dunning chases it with the steps it already has, without a second collection process.
- No notice is lost or applied twice: providers deliver callbacks at least once.
- Events already published (a plan completed, a contract completed, the center told) are facts:
  undoing them would need events that retract others, which no consumer understands.

## Considered options

1. The charge goes back to `failed`, due again on the day of the return, and dunning starts over
   from there; lending marks the instalment unpaid while the plan is being repaid (or after a
   default, whose debt is still recovered); a plan that ended on that payment stays ended.
2. As 1, but a plan that ended on that payment is reopened (`active` again) with its contract.
3. A `returned` status of its own on the charge, outside dunning, left to ops.

## Decision outcome

Option 1. `POST /webhooks/psp` takes `payment.returned`, signed and matched like the other
callbacks (the attempt key and the payment accepted for it) with the bank's reason code. The
charge records the attempt `returned`, owes the amount again (`ChargeReturned`; the statement
gets a `return` line, positive) and is `failed`, due that day. Dunning starts over from the
return, as for a charge billed late: a debit returned months after its due date would otherwise
put the contract in arrears, or write it off and default it, the next morning without a notice.
The same return delivered again writes nothing; a success delivered again after it is ignored.

Lending applies `ChargeReturned` to the instalment while the plan takes repayments: active, or
closed as `defaulted` (it records payments too, which billing keeps collecting after a default).
A return that arrives before the payment it undoes is refused and retried, so the two land in
order. A returned ISA charge marks its month uncollected again: its month stays counted towards
the cap and the payments, and an ISA plan ends only once every month charged is collected.

A plan that ended `repaid` on the payment returned, or `paid_off` by a payoff returned, is not
reopened: lending logs it and leaves the plan and the contract as they ended. Billing still owes
the charge: an instalment is dunned like any other (a completed contract ignores the arrears and
the default), a payoff, never dunned, waits for ops to collect it
again (`POST /charges/:id/retry`) or settle it with the student.

Option 2 would reopen a contract the center was told was completed, and its state machine has no
way back from `completed`; it is rare enough to be ops' work. Option 3 would leave the debt
outside dunning, where nothing chases it.

### Consequences

- Good: one place owes the money (the charge), one process chases it (dunning), and the
  statement, the plan and the dashboards show it owed again.
- Good: no new status: the charge's state machine gains one transition, `paid → failed`.
- Bad: the due date of a returned charge moves to the day of the return; its first due date
  stays on the statement's charge line. Ageing a debt from its first due date (for risk reports)
  would need that date kept apart.
- Bad: a payoff returned, or a last instalment returned, leaves a completed contract with a debt
  that only ops see as such (the charge is open, the schedule shows the plan ended).
- Bad: callbacks carry no amount. The key names the attempt and Tramo asked for the charge's
  amount under it; a real provider's adapter must compare the amount it echoes before recording.
