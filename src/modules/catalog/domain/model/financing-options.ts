import { type Money, type Percentage, ValueObject } from '@shared/domain';

import { InvalidFinancingOptionError } from '../errors/catalog-errors';

// Exported so request validation states the same bounds.
export const FINANCING_LIMITS = {
  minTermMonths: 6,
  maxTermMonths: 48,
  maxTerms: 12,
  maxAnnualRateBps: 2_500,
  maxIncomeShareBps: 2_000,
  maxIsaPayments: 120,
  maxGraceMonths: 12,
  minCapMultiplierHundredths: 100,
  maxCapMultiplierHundredths: 200,
} as const;
const {
  minTermMonths: MIN_TERM_MONTHS,
  maxTermMonths: MAX_TERM_MONTHS,
  maxTerms: MAX_TERMS,
  maxAnnualRateBps: MAX_ANNUAL_RATE_BPS,
  maxIncomeShareBps: MAX_INCOME_SHARE_BPS,
  maxIsaPayments: MAX_ISA_PAYMENTS,
  maxGraceMonths: MAX_GRACE_MONTHS,
  minCapMultiplierHundredths: MIN_CAP,
  maxCapMultiplierHundredths: MAX_CAP,
} = FINANCING_LIMITS;

// A loan repaid in equal monthly instalments over one of the allowed terms.
export interface InstallmentsOption {
  readonly allowedTerms: readonly number[];
  readonly annualRate: Percentage;
}

// An income share agreement: once employed and earning at least minMonthlyIncome, the graduate
// pays incomeShare of their income for at most maxPayments months, never more in total than
// capMultiplier times the program price, starting after graceMonths.
export interface IsaOption {
  readonly incomeShare: Percentage;
  readonly minMonthlyIncome: Money;
  readonly maxPayments: number;
  // In hundredths: 150 is 1.5 times the price.
  readonly capMultiplierHundredths: number;
  readonly graceMonths: number;
}

export type FinancingProduct = 'installments' | 'isa';

// The ways a program can be financed. Each option is checked on its own here; the rules that
// depend on the program (ISA needs employability) live in Program.
export class FinancingOptions extends ValueObject<{
  installments: InstallmentsOption | null;
  isa: IsaOption | null;
}> {
  private constructor(installments: InstallmentsOption | null, isa: IsaOption | null) {
    super({ installments, isa });
  }

  static none(): FinancingOptions {
    return new FinancingOptions(null, null);
  }

  static of(input: {
    installments?: InstallmentsOption | null;
    isa?: IsaOption | null;
  }): FinancingOptions {
    const installments = input.installments
      ? FinancingOptions.validInstallments(input.installments)
      : null;
    const isa = input.isa ? FinancingOptions.validIsa(input.isa) : null;
    return new FinancingOptions(installments, isa);
  }

  get installments(): InstallmentsOption | null {
    return this.props.installments;
  }

  get isa(): IsaOption | null {
    return this.props.isa;
  }

  get products(): FinancingProduct[] {
    return [
      ...(this.props.installments ? (['installments'] as const) : []),
      ...(this.props.isa ? (['isa'] as const) : []),
    ];
  }

  get isEmpty(): boolean {
    return this.products.length === 0;
  }

  private static validInstallments(option: InstallmentsOption): InstallmentsOption {
    const terms = [...new Set(option.allowedTerms)].sort((a, b) => a - b);
    if (terms.length === 0 || terms.length > MAX_TERMS) {
      throw new InvalidFinancingOptionError(
        `installments offer 1 to ${String(MAX_TERMS)} different terms`,
      );
    }
    if (
      terms.some(
        (term) => !Number.isInteger(term) || term < MIN_TERM_MONTHS || term > MAX_TERM_MONTHS,
      )
    ) {
      throw new InvalidFinancingOptionError(
        `instalment terms must be whole months between ${String(MIN_TERM_MONTHS)} and ${String(MAX_TERM_MONTHS)}`,
      );
    }
    if (option.annualRate.basisPoints > MAX_ANNUAL_RATE_BPS) {
      throw new InvalidFinancingOptionError('the annual rate cannot exceed 25 %');
    }
    return { allowedTerms: terms, annualRate: option.annualRate };
  }

  private static validIsa(option: IsaOption): IsaOption {
    if (
      option.capMultiplierHundredths < MIN_CAP ||
      option.capMultiplierHundredths > MAX_CAP ||
      !Number.isInteger(option.capMultiplierHundredths)
    ) {
      throw new InvalidFinancingOptionError(
        'the ISA cap must be between 1.0 and 2.0 times the price',
      );
    }
    if (
      option.incomeShare.basisPoints === 0 ||
      option.incomeShare.basisPoints > MAX_INCOME_SHARE_BPS
    ) {
      throw new InvalidFinancingOptionError('the income share must be above 0 % and at most 20 %');
    }
    if (option.minMonthlyIncome.cents <= 0) {
      throw new InvalidFinancingOptionError('the minimum monthly income must be positive');
    }
    if (
      !Number.isInteger(option.maxPayments) ||
      option.maxPayments < 1 ||
      option.maxPayments > MAX_ISA_PAYMENTS
    ) {
      throw new InvalidFinancingOptionError(
        `the ISA runs for 1 to ${String(MAX_ISA_PAYMENTS)} payments`,
      );
    }
    if (
      !Number.isInteger(option.graceMonths) ||
      option.graceMonths < 0 ||
      option.graceMonths > MAX_GRACE_MONTHS
    ) {
      throw new InvalidFinancingOptionError(
        `the grace period is 0 to ${String(MAX_GRACE_MONTHS)} months`,
      );
    }
    return option;
  }
}
