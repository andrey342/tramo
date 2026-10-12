import { AggregateRoot, CalendarDate, InvalidValueError, type Money } from '@shared/domain';

import { DeclarationTooLateError, InvalidPeriodError } from '../errors/billing-errors';
import { BillingEvents } from '../events/billing-events';

export type IncomeSource = 'self' | 'employment_provider';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

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

  // A month that has started: income is declared for the current month or a past one.
  static declare(input: {
    id: string;
    contractId: string;
    studentId: string;
    period: string;
    grossMonthlyIncome: Money;
    source: IncomeSource;
    // The first month lending has not assessed yet; an earlier one is closed.
    openFrom?: string | null;
    now: Date;
  }): IncomeDeclaration {
    if (!PERIOD.test(input.period)) {
      throw new InvalidPeriodError('expected a month as YYYY-MM');
    }
    if (input.period > CalendarDate.fromInstant(input.now).period) {
      throw new InvalidPeriodError('income is declared for a month that has started');
    }
    if (input.openFrom && input.period < input.openFrom) {
      throw new DeclarationTooLateError(input.period, input.openFrom);
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
