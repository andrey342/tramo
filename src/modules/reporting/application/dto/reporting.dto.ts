import { type CenterFigures } from '../../domain';

export type {
  ApplicationCounts as ApplicationCountsDto,
  CenterFigures as CenterFiguresDto,
  ContractCounts as ContractCountsDto,
  MoneyFigures as MoneyFiguresDto,
  ProductFigures as ProductFiguresDto,
} from '../../domain';

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

export interface CenterDashboardDto extends CenterFigures {
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
  // Shown only from a cohort large enough not to reveal one applicant's score (origination
  // decides), rounded to a band.
  readonly averageScore: number | null;
  readonly generatedAt: Date;
}

export interface OpsOverviewDto extends OpsFiguresDto {
  // Null when the dead-letter queue could not be read (Redis down).
  readonly deadLetters: number | null;
  readonly generatedAt: Date;
}
