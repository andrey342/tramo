import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { CursorPageQueryDto } from '@shared/infrastructure/http';

import {
  type CancellationReason,
  type CompletionReason,
  CONTRACT_STATUSES,
  type ContractStatus,
  DISBURSEMENT_STATUSES,
  type DisbursementStatus,
  type PlanStatus,
} from '../../domain';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListContractsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ enum: CONTRACT_STATUSES })
  @IsOptional()
  @IsIn(CONTRACT_STATUSES)
  status?: ContractStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Staff only; others see their own' })
  @IsOptional()
  @IsUUID()
  centerId?: string;
}

export class ListDisbursementsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ enum: DISBURSEMENT_STATUSES })
  @IsOptional()
  @IsIn(DISBURSEMENT_STATUSES)
  status?: DisbursementStatus;
}

export class PayoffQuoteRequest {
  @ApiPropertyOptional({
    example: '2026-11-03',
    description: 'Today (the default) or a day in the coming month',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'asOf must be a date as YYYY-MM-DD' })
  asOf?: string;
}

export class PayoffRequest {
  @ApiProperty({
    example: 612_345,
    description: 'The total of a quote for today; a different amount is refused with 409',
  })
  @IsInt()
  @Min(1)
  amountCents!: number;
}

// What the e-signature provider posts when an envelope is signed, declined or expires.
export class ESignatureCallbackRequest {
  @ApiProperty({ example: 'evt_0199a3c4' })
  @IsString()
  @MaxLength(200)
  eventId!: string;

  @ApiProperty({ enum: ['envelope.completed', 'envelope.declined', 'envelope.expired'] })
  @IsIn(['envelope.completed', 'envelope.declined', 'envelope.expired'])
  type!: 'envelope.completed' | 'envelope.declined' | 'envelope.expired';

  @ApiProperty({ example: 'sim-env-0199a3c4-…' })
  @IsString()
  @MaxLength(200)
  envelopeId!: string;

  @ApiPropertyOptional({ description: 'SHA-256 of the document signed; required when completed' })
  @ValidateIf((body: ESignatureCallbackRequest) => body.type === 'envelope.completed')
  @Matches(/^[0-9a-f]{64}$/)
  documentHash?: string;

  @ApiProperty({ example: '2026-10-12T10:00:00Z' })
  @IsISO8601({ strict: true })
  occurredAt!: string;
}

class ProgramResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 12 })
  durationWeeks!: number;
}

class ContractProductResponse {
  @ApiProperty({ enum: ['installments', 'isa'] })
  kind!: 'installments' | 'isa';

  @ApiPropertyOptional({ example: 24 })
  termMonths?: number;

  @ApiPropertyOptional({ example: 750, description: 'TIN' })
  annualRateBasisPoints?: number;

  @ApiPropertyOptional({ example: 776, description: 'TAE' })
  aprBasisPoints?: number;

  @ApiPropertyOptional({ example: 33_750 })
  monthlyPaymentCents?: number;

  @ApiPropertyOptional({ example: 1_000 })
  incomeShareBasisPoints?: number;

  @ApiPropertyOptional({ example: 150_000 })
  minMonthlyIncomeCents?: number;

  @ApiPropertyOptional({ example: 36 })
  maxPayments?: number;

  @ApiPropertyOptional({ example: 1_125_000 })
  capCents?: number;

  @ApiPropertyOptional({ example: 3 })
  graceMonths?: number;
}

class PayoutResponse {
  @ApiProperty({ example: 500 })
  platformFeeBasisPoints!: number;

  @ApiProperty({ example: 712_500 })
  disbursementAmountCents!: number;

  @ApiProperty({ enum: DISBURSEMENT_STATUSES, nullable: true })
  disbursementStatus!: DisbursementStatus | null;

  @ApiProperty({ nullable: true, type: Date })
  settledAt!: Date | null;
}

class SignatureResponse {
  @ApiProperty({ example: 'simulated' })
  provider!: string;

  @ApiProperty()
  envelopeId!: string;

  @ApiProperty({ description: 'SHA-256 of GET /contracts/:id/document' })
  documentHash!: string;

  @ApiProperty()
  sentAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  signedAt!: Date | null;
}

export class ContractResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  applicationId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({ type: ProgramResponse })
  program!: ProgramResponse;

  @ApiProperty({ example: 750_000 })
  principalCents!: number;

  @ApiProperty({ example: 'EUR' })
  currency!: 'EUR';

  @ApiProperty({ type: ContractProductResponse })
  product!: ContractProductResponse;

  @ApiProperty({
    type: PayoutResponse,
    nullable: true,
    description: 'What the center is paid: the center and staff see it',
  })
  payout!: PayoutResponse | null;

  @ApiProperty({ type: SignatureResponse, nullable: true })
  signature!: SignatureResponse | null;

  @ApiProperty({ enum: CONTRACT_STATUSES })
  status!: ContractStatus;

  @ApiProperty({ nullable: true, type: String, example: '2026-10-12' })
  activatedOn!: string | null;

  @ApiProperty({ nullable: true, enum: ['signature_declined', 'signature_expired'] })
  cancellationReason!: CancellationReason | null;

  @ApiProperty()
  statusChangedAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}

class ContractSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  applicationId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty()
  programName!: string;

  @ApiProperty({ example: 750_000 })
  principalCents!: number;

  @ApiProperty({ enum: ['installments', 'isa'] })
  product!: 'installments' | 'isa';

  @ApiProperty({ enum: CONTRACT_STATUSES })
  status!: ContractStatus;

  @ApiProperty()
  statusChangedAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}

export class ContractPageResponse {
  @ApiProperty({ type: [ContractSummaryResponse] })
  data!: readonly ContractSummaryResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

class InstallmentResponse {
  @ApiProperty({ example: 1 })
  number!: number;

  @ApiProperty({ example: '2026-11-12' })
  dueDate!: string;

  @ApiProperty({ example: 29_062 })
  principalCents!: number;

  @ApiProperty({ example: 4_688 })
  interestCents!: number;

  @ApiProperty({ example: 33_750 })
  totalCents!: number;

  @ApiProperty({ example: 720_938 })
  balanceAfterCents!: number;

  @ApiProperty()
  paid!: boolean;
}

class PayoffRequestedResponse {
  @ApiProperty()
  amountCents!: number;

  @ApiProperty({ example: '2026-11-03' })
  asOf!: string;
}

export class ScheduleResponse {
  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ enum: ['installments', 'isa'] })
  kind!: 'installments' | 'isa';

  @ApiProperty({ example: '2026-10-12' })
  startsOn!: string;

  @ApiProperty({ enum: ['active', 'completed'] })
  status!: PlanStatus;

  @ApiProperty({
    nullable: true,
    enum: ['repaid', 'paid_off', 'cap_reached', 'max_payments', 'window_expired', 'defaulted'],
  })
  completionReason!: CompletionReason | null;

  @ApiPropertyOptional({ description: 'Instalments' })
  installmentsPaid?: number;

  @ApiPropertyOptional({ type: [InstallmentResponse], description: 'Instalments' })
  installments?: readonly InstallmentResponse[];

  @ApiPropertyOptional({ type: PayoffRequestedResponse, nullable: true })
  payoffRequested?: PayoffRequestedResponse | null;

  @ApiPropertyOptional({ description: 'ISA' })
  incomeShareBasisPoints?: number;

  @ApiPropertyOptional({ description: 'ISA' })
  minMonthlyIncomeCents?: number;

  @ApiPropertyOptional({ description: 'ISA' })
  maxPayments?: number;

  @ApiPropertyOptional({ description: 'ISA' })
  capCents?: number;

  @ApiPropertyOptional({ example: '2027-07', description: 'ISA: first month charged' })
  firstPeriod?: string;

  @ApiPropertyOptional({ example: '2035-01-04', description: 'ISA: the obligation lapses' })
  windowEndsOn?: string;

  @ApiPropertyOptional({ description: 'ISA' })
  chargedSoFarCents?: number;

  @ApiPropertyOptional({ description: 'ISA' })
  paymentsMade?: number;

  @ApiPropertyOptional({ description: 'ISA: two months in a row without a declaration' })
  declarationOverdue?: boolean;
}

export class PayoffQuoteResponse {
  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ example: '2026-11-03' })
  asOf!: string;

  @ApiProperty()
  overdueInstallments!: number;

  @ApiProperty()
  overdueAmountCents!: number;

  @ApiProperty()
  outstandingPrincipalCents!: number;

  @ApiProperty()
  accruedInterestCents!: number;

  @ApiProperty({ description: 'What paying everything off costs on asOf' })
  totalCents!: number;
}

export class DisbursementResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({ example: 712_500 })
  amountCents!: number;

  @ApiProperty({ example: 1 })
  attempt!: number;

  @ApiProperty({ enum: DISBURSEMENT_STATUSES })
  status!: DisbursementStatus;

  @ApiProperty({ nullable: true, type: String, example: 'account_closed' })
  failureReason!: string | null;

  @ApiProperty()
  statusChangedAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  settledAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class DisbursementPageResponse {
  @ApiProperty({ type: [DisbursementResponse] })
  data!: readonly DisbursementResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
