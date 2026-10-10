import { type Money, type Percentage } from '@shared/domain';

import { ProductNotOfferedError } from '../errors/origination-errors';

// The program as it was when the student applied (refreshed on submit): price and options can
// change in the catalog afterwards without changing what this application is about.
export interface ProgramSnapshot {
  readonly programId: string;
  readonly centerId: string;
  readonly name: string;
  readonly price: Money;
  readonly employabilityRate: Percentage;
  // Average gross annual salary of graduates.
  readonly avgStartingSalary: Money;
  readonly installments: {
    readonly allowedTerms: readonly number[];
    readonly annualRate: Percentage;
  } | null;
  readonly isa: {
    readonly incomeShare: Percentage;
    readonly minMonthlyIncome: Money;
    readonly maxPayments: number;
    readonly capMultiplierHundredths: number;
    readonly graceMonths: number;
  } | null;
}

export type RequestedProduct =
  { readonly kind: 'installments'; readonly termMonths: number } | { readonly kind: 'isa' };

export function assertProductOffered(program: ProgramSnapshot, product: RequestedProduct): void {
  if (product.kind === 'isa') {
    if (!program.isa) {
      throw new ProductNotOfferedError('the program has no income share agreement');
    }
    return;
  }
  if (!program.installments) {
    throw new ProductNotOfferedError('the program is not financed in instalments');
  }
  if (!program.installments.allowedTerms.includes(product.termMonths)) {
    throw new ProductNotOfferedError(
      `instalments run over ${program.installments.allowedTerms.join(', ')} months`,
    );
  }
}
