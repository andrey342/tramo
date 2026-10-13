import { AggregateRoot, CalendarDate, InvalidValueError, type Money } from '@shared/domain';

import { InvalidPeriodError, PeriodNotOpenError } from '../errors/billing-errors';
import { BillingEvents } from '../events/billing-events';

export type IncomeSource = 'self' | 'employment_provider';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// A month of income is declared from its first day until the end of the 4th of the next month,
// so a salary paid on the last days of the month or the first days of the next is declared in
// time. On the 5th the window has closed: the cycle assesses the month, with or without a
// declaration, and its charge falls due that day.
export const ISA_DUE_DAY = 5;

// The day the declarations of a month close, and it is assessed and charged.
export function isaPeriodClosesOn(period: string): CalendarDate {
  return CalendarDate.parse(`${period}-01`).addMonths(1).withDay(ISA_DUE_DAY);
}

// The earliest month still open on a day: the previous one until the 4th, then the current one.
export function firstDeclarablePeriod(today: CalendarDate): string {
  const month = today.startOfMonth();
  return (today.day < ISA_DUE_DAY ? month.addMonths(-1) : month).period;
}

export interface IncomeDeclarationProps {
  readonly contractId: string;
  readonly studentId: string;
  // The month the income was earned in, as YYYY-MM.
  readonly period: string;
  readonly grossMonthlyIncome: Money;
  readonly source: IncomeSource;
  readonly declaredAt: Date;
}

// What an ISA student earned in one month. Personal financial data: the amount stays in billing,
// events carry only that a declaration exists. One per contract and month.
export class IncomeDeclaration extends AggregateRoot {
  private constructor(
    id: string,
    private props: IncomeDeclarationProps,
  ) {
    super(id);
  }

  // A month that has started and whose window has not closed: the current month, or the previous
  // one until the 4th.
  static declare(input: {
    id: string;
    contractId: string;
    studentId: string;
    period: string;
    grossMonthlyIncome: Money;
    source: IncomeSource;
    // The first month lending has not assessed yet; an earlier one is not open.
    openFrom?: string | null;
    // The day the windows are judged on: today, or a day still to come where the demo walks the
    // months (never a past one, which would reopen closed windows).
    asOf?: CalendarDate;
    now: Date;
  }): IncomeDeclaration {
    if (!PERIOD.test(input.period)) {
      throw new InvalidPeriodError('expected a month as YYYY-MM');
    }
    const today = CalendarDate.fromInstant(input.now);
    if (input.asOf?.isBefore(today)) {
      throw new InvalidValueError('asOf', 'Income is declared as of today or a day to come.');
    }
    const day = input.asOf ?? today;
    if (input.period > day.period) {
      throw new InvalidPeriodError('income is declared for a month that has started');
    }
    const windowOpenFrom = firstDeclarablePeriod(day);
    const openFrom =
      input.openFrom && input.openFrom > windowOpenFrom ? input.openFrom : windowOpenFrom;
    if (input.period < openFrom) {
      throw new PeriodNotOpenError(input.period, openFrom);
    }
    if (input.grossMonthlyIncome.isNegative()) {
      throw new InvalidValueError('grossMonthlyIncome', 'Income cannot be negative.');
    }
    const declaration = new IncomeDeclaration(input.id, {
      contractId: input.contractId,
      studentId: input.studentId,
      period: input.period,
      grossMonthlyIncome: input.grossMonthlyIncome,
      source: input.source,
      declaredAt: input.now,
    });
    declaration.record({
      eventType: BillingEvents.IncomeDeclared,
      aggregateType: 'IncomeDeclaration',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        declarationId: input.id,
        contractId: input.contractId,
        studentId: input.studentId,
        period: input.period,
      },
    });
    return declaration;
  }

  static reconstitute(id: string, props: IncomeDeclarationProps): IncomeDeclaration {
    return new IncomeDeclaration(id, props);
  }

  get contractId(): string {
    return this.props.contractId;
  }

  get studentId(): string {
    return this.props.studentId;
  }

  get period(): string {
    return this.props.period;
  }

  get grossMonthlyIncome(): Money {
    return this.props.grossMonthlyIncome;
  }

  get source(): IncomeSource {
    return this.props.source;
  }

  get declaredAt(): Date {
    return this.props.declaredAt;
  }
}
