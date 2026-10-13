import { ApiProperty } from '@nestjs/swagger';

class ApplicationCountsResponse {
  @ApiProperty({ description: 'Submitted, still being verified or scored' })
  submitted!: number;

  @ApiProperty()
  approved!: number;

  @ApiProperty({ description: 'Waiting for an analyst' })
  needsReview!: number;

  @ApiProperty()
  rejected!: number;

  @ApiProperty({ description: 'Offer accepted: the contract follows' })
  offerAccepted!: number;

  @ApiProperty()
  cancelled!: number;

  @ApiProperty()
  expired!: number;
}

class ContractCountsResponse {
  @ApiProperty()
  active!: number;

  @ApiProperty()
  inArrears!: number;

  @ApiProperty()
  completed!: number;

  @ApiProperty()
  defaulted!: number;

  @ApiProperty()
  cancelled!: number;
}

class ProductFiguresResponse {
  @ApiProperty({ enum: ['installments', 'isa'] })
  product!: 'installments' | 'isa';

  @ApiProperty({ type: ContractCountsResponse })
  contracts!: ContractCountsResponse;

  @ApiProperty({ description: 'Paid to the center, settled' })
  disbursedCents!: number;

  @ApiProperty()
  collectedCents!: number;

  @ApiProperty({ description: 'Charged and not collected yet' })
  outstandingCents!: number;

  @ApiProperty()
  writtenOffCents!: number;
}

export class CenterDashboardResponse {
  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({
    type: ApplicationCountsResponse,
    description: 'Applications by where they are now',
  })
  applications!: ApplicationCountsResponse;

  @ApiProperty({ type: ContractCountsResponse })
  contracts!: ContractCountsResponse;

  @ApiProperty({ example: 7_125_00 })
  disbursedCents!: number;

  @ApiProperty({ example: 675_00 })
  collectedCents!: number;

  @ApiProperty({ example: 337_50 })
  outstandingCents!: number;

  @ApiProperty({ example: 0 })
  writtenOffCents!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 500,
    description: 'Contracts in arrears among those being repaid, in basis points',
  })
  delinquencyRateBasisPoints!: number | null;

  @ApiProperty({ type: [ProductFiguresResponse] })
  byProduct!: readonly ProductFiguresResponse[];

  @ApiProperty()
  generatedAt!: Date;
}

export class ProgramPerformanceResponse {
  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({ format: 'uuid' })
  programId!: string;

  @ApiProperty()
  applications!: number;

  @ApiProperty()
  approved!: number;

  @ApiProperty()
  rejected!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 7_500,
    description: 'Approved among decided, in basis points',
  })
  approvalRateBasisPoints!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 7_500_00 })
  averageTicketCents!: number | null;

  @ApiProperty()
  scoredApplications!: number;

  @ApiProperty({ nullable: true, type: Number, example: 72, description: '0 to 100' })
  averageScore!: number | null;

  @ApiProperty()
  generatedAt!: Date;
}

export class OpsOverviewResponse {
  @ApiProperty({ description: 'Applications waiting for an analyst' })
  reviewQueue!: number;

  @ApiProperty({ description: 'Collections that failed today (UTC)' })
  failedChargesToday!: number;

  @ApiProperty({ description: 'Transfers to centers not settled yet' })
  pendingDisbursements!: number;

  @ApiProperty()
  failedDisbursements!: number;

  @ApiProperty()
  contractsInArrears!: number;

  @ApiProperty({ description: 'Jobs in the dead-letter queue' })
  deadLetters!: number;

  @ApiProperty()
  generatedAt!: Date;
}

export class RebuildResponse {
  @ApiProperty({ description: 'False when a rebuild was already queued or running' })
  queued!: boolean;
}
