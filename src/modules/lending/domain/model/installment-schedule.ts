import { Decimal } from 'decimal.js';

import {
  annuityPayment,
  type CalendarDate,
  Money,
  monthlyRate,
  type Percentage,
} from '@shared/domain';

import { InvalidContractTermsError } from '../errors/lending-errors';

export interface InstallmentRow {
  readonly number: number;
  readonly dueDate: CalendarDate;
  readonly principal: Money;
  readonly interest: Money;
  readonly total: Money;
  readonly balanceAfter: Money;
}

// Instalments fall due on the day of the month the contract was activated, from the next month
// on; days a month may lack (29-31) move to the 28th, so every instalment keeps the same day.
export const LATEST_DUE_DAY = 28;

export function firstDueDate(activatedOn: CalendarDate): CalendarDate {
  return activatedOn.addMonths(1).withDay(Math.min(activatedOn.day, LATEST_DUE_DAY));
}

// French amortisation: a constant instalment A = P·i / (1 − (1 + i)^−n), i = TIN / 12 (P / n at
// 0 %). Each row's interest is the balance times i, rounded half-up to the cent; its principal is
// A minus that interest. The last row repays whatever balance is left, so the principals add up
// to P exactly and the rounding of every row ends up in the last instalment.
export function amortizationSchedule(input: {
  principal: Money;
  annualRate: Percentage;
  termMonths: number;
  firstDueDate: CalendarDate;
}): InstallmentRow[] {
  const payment = annuityPayment(input.principal, input.annualRate, input.termMonths);
  const rate = monthlyRate(input.annualRate);
  const rows: InstallmentRow[] = [];
  let balance = input.principal;
  for (let number = 1; number <= input.termMonths; number += 1) {
    const interest = balance.multiply(rate);
    const principal = number === input.termMonths ? balance : payment.subtract(interest);
    if (principal.gt(balance) || principal.isNegative()) {
      throw new InvalidContractTermsError('the principal is too small for the term');
    }
    balance = balance.subtract(principal);
    rows.push({
      number,
      dueDate: input.firstDueDate.addMonths(number - 1),
      principal,
      interest,
      total: principal.add(interest),
      balanceAfter: balance,
    });
  }
  return rows;
}

export interface PayoffQuote {
  readonly asOf: CalendarDate;
  // Instalments already due and not yet paid: they are part of the payoff.
  readonly overdueInstallments: number;
  readonly overdueAmount: Money;
  // Principal of the instalments not yet due.
  readonly outstandingPrincipal: Money;
  // Interest on that principal from the last due date to asOf, pro rata of the current month.
  readonly accruedInterest: Money;
  readonly total: Money;
}

// Paying everything off on `asOf`: what is overdue, the principal still outstanding and the
// interest it has accrued in the month so far (balance × i × days elapsed / days in the period,
// half-up). No fee.
export function payoffQuote(input: {
  schedule: readonly InstallmentRow[];
  principal: Money;
  annualRate: Percentage;
  startsOn: CalendarDate;
  paidInstallments: readonly number[];
  asOf: CalendarDate;
}): PayoffQuote {
  const { schedule, asOf } = input;
  const paid = new Set(input.paidInstallments);
  const due = schedule.filter((row) => !row.dueDate.isAfter(asOf)).length;
  const overdue = schedule.slice(0, due).filter((row) => !paid.has(row.number));
  // Instalments are charged when they fall due, so the balance is the one after the last due.
  const settled = due;
  const balance =
    settled === 0 ? input.principal : (schedule[settled - 1]?.balanceAfter ?? Money.zero());
  const next = schedule[settled];
  let accruedInterest = Money.zero();
  if (next) {
    const periodStart =
      settled === 0 ? input.startsOn : (schedule[settled - 1]?.dueDate ?? input.startsOn);
    const periodDays = periodStart.daysUntil(next.dueDate);
    const elapsed = Math.min(Math.max(periodStart.daysUntil(asOf), 0), periodDays);
    accruedInterest = balance.multiply(
      monthlyRate(input.annualRate).times(elapsed).dividedBy(new Decimal(periodDays)),
    );
  }
  const overdueAmount = Money.sum(overdue.map((row) => row.total));
  return {
    asOf,
    overdueInstallments: overdue.length,
    overdueAmount,
    outstandingPrincipal: balance,
    accruedInterest,
    total: overdueAmount.add(balance).add(accruedInterest),
  };
}
