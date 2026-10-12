import { type Money, type Percentage } from '@shared/domain';

import { type Contract } from '../model/contract';
import { annualPercentageRateOf, isaCap, monthlyInstallment } from '../model/contract-terms';
import { ISA_WINDOW_YEARS } from '../model/isa-rules';

// The text the student signs. Rendered from the contract alone, so it is the same every time:
// its SHA-256 travels with the envelope and the signature callback must carry it back.
export function renderContractDocument(contract: Contract): string {
  const { terms, program } = contract;
  const lines = [
    'TRAMO - EDUCATION FINANCING AGREEMENT',
    '',
    `Contract: ${contract.id}`,
    `Application: ${contract.applicationId}`,
    `Student account: ${contract.studentId}`,
    `Training center: ${contract.centerId}`,
    `Program: ${program.name} (${program.programId}), ${String(program.durationWeeks)} weeks`,
    '',
    `Amount financed: ${money(terms.principal)}, paid by Tramo directly to the training center.`,
    '',
  ];
  const { product } = terms;
  if (product.kind === 'installments') {
    lines.push(
      'Product: instalment loan (French amortisation)',
      `Term: ${String(product.termMonths)} monthly instalments`,
      `Nominal annual rate (TIN): ${rate(product.annualRate)}`,
      `Annual percentage rate (TAE): ${rate(annualPercentageRateOf(terms) ?? product.annualRate)}`,
      `Monthly instalment: ${money(monthlyInstallment(terms) ?? terms.principal)}; the last one absorbs the rounding.`,
      'Early repayment: the whole outstanding principal plus the interest accrued in the month, without fees.',
    );
  } else {
    lines.push(
      'Product: income share agreement',
      `Income share: ${rate(product.incomeShare)} of gross monthly income`,
      `Threshold: no payment in a month with income below ${money(product.minMonthlyIncome)}; such a month is paused, not owed.`,
      `Limits: at most ${String(product.maxPayments)} payments and never more than ${money(isaCap(terms.principal, product.capMultiplierHundredths))} in total.`,
      `Start: the first full month after ${String(product.graceMonths)} months from the end of the program.`,
      `End: the obligation lapses ${String(ISA_WINDOW_YEARS)} years after the end of the program.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function money(amount: Money): string {
  return `${amount.toDecimalString()} ${amount.currency}`;
}

function rate(percentage: Percentage): string {
  return `${(percentage.basisPoints / 100).toFixed(2)} %`;
}
