import { Money, Percentage } from '@shared/domain';

import { FinancingOptions, type ProgramDetails, type ProgramModality } from '../domain';

// What clients send for a program, in plain numbers (cents, basis points); turned into domain
// values here so commands stay free of HTTP types.
export interface ProgramDetailsInput {
  readonly name: string;
  readonly modality: ProgramModality;
  readonly priceCents: number;
  readonly durationWeeks: number;
  readonly startDates: readonly string[];
  readonly employabilityRateBasisPoints: number;
  readonly avgStartingSalaryCents: number;
}

export interface FinancingInput {
  readonly installments?: {
    readonly allowedTerms: readonly number[];
    readonly annualRateBasisPoints: number;
  } | null;
  readonly isa?: {
    readonly incomeShareBasisPoints: number;
    readonly minMonthlyIncomeCents: number;
    readonly maxPayments: number;
    // 150 is a cap of one and a half times the price.
    readonly capMultiplierHundredths: number;
    readonly graceMonths: number;
  } | null;
}

export function toProgramDetails(input: ProgramDetailsInput): ProgramDetails {
  return {
    name: input.name,
    modality: input.modality,
    price: Money.fromCents(input.priceCents),
    durationWeeks: input.durationWeeks,
    startDates: input.startDates,
    employabilityRate: Percentage.fromBasisPoints(input.employabilityRateBasisPoints),
    avgStartingSalary: Money.fromCents(input.avgStartingSalaryCents),
  };
}

// Only the fields the client sent.
export function toProgramDetailChanges(
  input: Partial<ProgramDetailsInput>,
): Partial<ProgramDetails> {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.modality !== undefined && { modality: input.modality }),
    ...(input.priceCents !== undefined && { price: Money.fromCents(input.priceCents) }),
    ...(input.durationWeeks !== undefined && { durationWeeks: input.durationWeeks }),
    ...(input.startDates !== undefined && { startDates: input.startDates }),
    ...(input.employabilityRateBasisPoints !== undefined && {
      employabilityRate: Percentage.fromBasisPoints(input.employabilityRateBasisPoints),
    }),
    ...(input.avgStartingSalaryCents !== undefined && {
      avgStartingSalary: Money.fromCents(input.avgStartingSalaryCents),
    }),
  };
}

export function toFinancingOptions(input: FinancingInput): FinancingOptions {
  return FinancingOptions.of({
    installments: input.installments
      ? {
          allowedTerms: input.installments.allowedTerms,
          annualRate: Percentage.fromBasisPoints(input.installments.annualRateBasisPoints),
        }
      : null,
    isa: input.isa
      ? {
          incomeShare: Percentage.fromBasisPoints(input.isa.incomeShareBasisPoints),
          minMonthlyIncome: Money.fromCents(input.isa.minMonthlyIncomeCents),
          maxPayments: input.isa.maxPayments,
          capMultiplierHundredths: input.isa.capMultiplierHundredths,
          graceMonths: input.isa.graceMonths,
        }
      : null,
  });
}
