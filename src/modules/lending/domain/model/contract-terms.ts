import { Decimal } from 'decimal.js';

import { annualPercentageRate, annuityPayment, type Money, type Percentage } from '@shared/domain';

import { InvalidContractTermsError } from '../errors/lending-errors';

// The course a contract finances, as it was when the contract was drawn up.
export interface FinancedProgram {
  readonly programId: string;
  readonly name: string;
  readonly durationWeeks: number;
}

export type ContractProduct =
  | {
      readonly kind: 'installments';
      readonly termMonths: number;
      readonly annualRate: Percentage;
    }
  | {
      readonly kind: 'isa';
      readonly incomeShare: Percentage;
      readonly minMonthlyIncome: Money;
      readonly maxPayments: number;
      // 150 caps everything the student pays at 1.5 times the principal.
      readonly capMultiplierHundredths: number;
      readonly graceMonths: number;
    };

// Fixed when the contract is drawn up; the student signs exactly these.
export interface ContractTerms {
  // The program price, financed in full.
  readonly principal: Money;
  // Kept by Tramo from what is paid to the center; the student does not pay it.
  readonly platformFee: Percentage;
  readonly product: ContractProduct;
}

export function validTerms(terms: ContractTerms): ContractTerms {
  if (!terms.principal.isPositive()) {
    throw new InvalidContractTermsError('the principal must be positive');
  }
  const { product } = terms;
  if (product.kind === 'installments') {
    if (!Number.isInteger(product.termMonths) || product.termMonths < 1) {
      throw new InvalidContractTermsError('the term is a whole number of months');
    }
    return terms;
  }
  if (product.incomeShare.isZero()) {
    throw new InvalidContractTermsError('an income share agreement needs a share');
  }
  if (!Number.isInteger(product.maxPayments) || product.maxPayments < 1) {
    throw new InvalidContractTermsError('the maximum number of payments must be positive');
  }
  if (!Number.isInteger(product.capMultiplierHundredths) || product.capMultiplierHundredths < 100) {
    throw new InvalidContractTermsError('the cap is at least the principal');
  }
  if (!Number.isInteger(product.graceMonths) || product.graceMonths < 0) {
    throw new InvalidContractTermsError('the grace period is a whole number of months');
  }
  return terms;
}

export function platformFeeAmount(terms: ContractTerms): Money {
  return terms.principal.percentage(terms.platformFee);
}

// What the training center receives.
export function disbursementAmount(terms: ContractTerms): Money {
  return terms.principal.subtract(platformFeeAmount(terms));
}

// The most an ISA student ever pays.
export function isaCap(principal: Money, capMultiplierHundredths: number): Money {
  return principal.multiply(new Decimal(capMultiplierHundredths).dividedBy(100));
}

export function monthlyInstallment(terms: ContractTerms): Money | null {
  const { product } = terms;
  return product.kind === 'installments'
    ? annuityPayment(terms.principal, product.annualRate, product.termMonths)
    : null;
}

export function annualPercentageRateOf(terms: ContractTerms): Percentage | null {
  return terms.product.kind === 'installments'
    ? annualPercentageRate(terms.product.annualRate)
    : null;
}
