import { type FinancingProduct, type ProgramModality, type ProgramStatus } from '../../domain';

// A type alias, not an interface, so the audit log accepts it as JSON.
export type FinancingOptionsDto = {
  readonly installments: {
    readonly allowedTerms: readonly number[];
    readonly annualRateBasisPoints: number;
  } | null;
  readonly isa: {
    readonly incomeShareBasisPoints: number;
    readonly minMonthlyIncomeCents: number;
    readonly maxPayments: number;
    // Whole hundredths, like every other amount here: 150 caps the total at 1.5 times the price.
    readonly capMultiplierHundredths: number;
    readonly graceMonths: number;
  } | null;
};

// Part of the module's public surface: origination reads programs through it.
export interface ProgramDto {
  readonly id: string;
  readonly centerId: string;
  readonly name: string;
  readonly modality: ProgramModality;
  readonly priceCents: number;
  readonly currency: 'EUR';
  readonly durationWeeks: number;
  readonly startDates: readonly string[];
  readonly employabilityRateBasisPoints: number;
  readonly avgStartingSalaryCents: number;
  readonly financing: FinancingOptionsDto;
  readonly products: readonly FinancingProduct[];
  readonly status: ProgramStatus;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
}

// As the public catalog lists it: with the name of the center that teaches it.
export interface CatalogProgramDto extends ProgramDto {
  readonly centerName: string;
}

export interface ProgramFilter {
  readonly centerId?: string;
  readonly modality?: ProgramModality;
  readonly product?: FinancingProduct;
  readonly minPriceCents?: number;
  readonly maxPriceCents?: number;
}
