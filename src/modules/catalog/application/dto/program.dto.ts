import { type FinancingProduct, type ProgramModality, type ProgramStatus } from '../../domain';

export interface FinancingOptionsDto {
  readonly installments: {
    readonly allowedTerms: readonly number[];
    readonly annualRateBasisPoints: number;
  } | null;
  readonly isa: {
    readonly incomeShareBasisPoints: number;
    readonly minMonthlyIncomeCents: number;
    readonly maxPayments: number;
    readonly capMultiplier: number;
    readonly graceMonths: number;
  } | null;
}

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
