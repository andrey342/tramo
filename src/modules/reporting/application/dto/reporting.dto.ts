// What the read models answer, as counts and sums; the use cases add rates and averages.

export interface ApplicationCountsDto {
  readonly submitted: number;
  readonly approved: number;
  readonly needsReview: number;
  readonly rejected: number;
  readonly offerAccepted: number;
  readonly cancelled: number;
  readonly expired: number;
}

export interface ContractCountsDto {
  readonly active: number;
  readonly inArrears: number;
  readonly completed: number;
  readonly defaulted: number;
  readonly cancelled: number;
}

export interface MoneyFiguresDto {
  readonly disbursedCents: number;
  readonly collectedCents: number;
  // Charged and not collected yet: scheduled, failed or overdue.
  readonly outstandingCents: number;
  readonly writtenOffCents: number;
}

export interface ProductFiguresDto extends MoneyFiguresDto {
  readonly product: 'installments' | 'isa';
  readonly contracts: ContractCountsDto;
}

export interface CenterFiguresDto extends MoneyFiguresDto {
  // Applications by where they are now; one that was approved and then accepted counts as
  // accepted.
  readonly applications: ApplicationCountsDto;
  readonly contracts: ContractCountsDto;
  readonly byProduct: readonly ProductFiguresDto[];
}

export interface ProgramFiguresDto {
  readonly applications: number;
  readonly approved: number;
  readonly rejected: number;
  // The sum of the amounts asked, over the applications whose amount is known.
  readonly amountCents: number;
  readonly pricedApplications: number;
}

export interface OpsFiguresDto {
  readonly reviewQueue: number;
  readonly failedChargesToday: number;
  readonly pendingDisbursements: number;
  readonly failedDisbursements: number;
  readonly contractsInArrears: number;
}

export interface CenterDashboardDto extends CenterFiguresDto {
  readonly centerId: string;
  // Contracts in arrears among those being repaid; null while none is.
  readonly delinquencyRateBasisPoints: number | null;
  readonly generatedAt: Date;
}

export interface ProgramPerformanceDto {
  readonly centerId: string;
  readonly programId: string;
  readonly applications: number;
  readonly approved: number;
  readonly rejected: number;
  // Approved among decided (approved or rejected); null while none is.
  readonly approvalRateBasisPoints: number | null;
  readonly averageTicketCents: number | null;
  readonly scoredApplications: number;
  readonly averageScore: number | null;
  readonly generatedAt: Date;
}

export interface OpsOverviewDto extends OpsFiguresDto {
  readonly deadLetters: number;
  readonly generatedAt: Date;
}
