import { Command, Query } from '@nestjs/cqrs';

import { type ContractStatus } from '../../domain';

// What billing has to charge for one plan: the instalments not paid yet, or the next month of an
// ISA to assess.
export interface BillablePlanDto {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly contractStatus: ContractStatus;
  readonly kind: 'installments' | 'isa';
  readonly unpaidInstallments: readonly {
    readonly number: number;
    readonly dueDate: string;
    readonly totalCents: number;
  }[];
  // ISA only: the next month of income to assess, as YYYY-MM.
  readonly nextIsaPeriod: string | null;
}

// Part of the module's public surface: billing's monthly cycle walks the plans being repaid
// (contract active or in arrears, plan not ended), a page at a time in contract id order.
export class ListBillablePlansQuery extends Query<readonly BillablePlanDto[]> {
  constructor(
    readonly afterContractId: string | null,
    readonly limit: number,
  ) {
    super();
  }
}

export type IsaAssessmentDto =
  | { readonly outcome: 'charge'; readonly amountCents: number }
  | { readonly outcome: 'paused'; readonly reason: 'no_declaration' | 'below_threshold' }
  | { readonly outcome: 'not_started' }
  | { readonly outcome: 'ended' };

// Part of the module's public surface: billing hands lending the income declared for one month
// of an ISA (null when none was) and charges what lending's rules make of it. Run inside
// billing's unit of work, so the assessment and the charge are written together.
export class AssessIsaPeriodCommand extends Command<IsaAssessmentDto> {
  constructor(
    readonly contractId: string,
    readonly period: string,
    readonly declaredIncomeCents: number | null,
  ) {
    super();
  }
}
