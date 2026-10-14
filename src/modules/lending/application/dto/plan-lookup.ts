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
// (contract active or in arrears, plan not ended, no payoff being collected), a page at a time
// in contract id order; `contractId` narrows it to one contract.
export class ListBillablePlansQuery extends Query<readonly BillablePlanDto[]> {
  constructor(
    readonly afterContractId: string | null,
    readonly limit: number,
    readonly contractId: string | null = null,
  ) {
    super();
  }
}

// `planEnded`: the month assessed ended the plan (its cap, its last payment or its window);
// there is nothing more to assess.
export type IsaAssessmentDto = (
  | { readonly outcome: 'charge'; readonly amountCents: number }
  | { readonly outcome: 'paused'; readonly reason: 'no_declaration' | 'below_threshold' }
  | { readonly outcome: 'not_started' }
  | { readonly outcome: 'ended' }
) & { readonly planEnded: boolean };

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

// Part of the module's public surface: the principal of each instalment of a loan not paid yet,
// whatever the plan's state; null for an ISA or a contract without a plan. Billing raises from
// it what a defaulted loan had left to bill.
export class FindUnpaidPrincipalQuery extends Query<
  readonly { readonly number: number; readonly principalCents: number }[] | null
> {
  constructor(readonly contractId: string) {
    super();
  }
}
