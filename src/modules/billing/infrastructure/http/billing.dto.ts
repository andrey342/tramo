import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { CHARGE_STATUSES, type ChargeKind, type ChargeStatus } from '../../domain';

export class SignMandateRequest {
  @ApiProperty({ example: 'ES76 2077 0024 0031 0257 5766', description: 'The account to debit' })
  @IsString()
  @MinLength(15)
  @MaxLength(42)
  iban!: string;
}

export class DeclareIncomeRequest {
  @ApiProperty({
    example: '2026-11',
    description: 'The month the income was earned in; open until the 4th of the next month',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be a month as YYYY-MM' })
  period!: string;

  @ApiProperty({ example: 2_150_00, description: 'Gross income of that month; 0 when none' })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  grossMonthlyIncomeCents!: number;
}

export class AsOfQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'The day to run as of; today when omitted (demo and catch-up)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOf must be a date as YYYY-MM-DD' })
  asOf?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Run for this contract only' })
  @IsOptional()
  @IsUUID()
  contractId?: string;
}

const PAYMENT_CALLBACK_TYPES = ['payment.succeeded', 'payment.failed', 'payment.returned'] as const;
type PaymentCallbackType = (typeof PAYMENT_CALLBACK_TYPES)[number];

// What the payment service provider posts about a collection. No amount: the key names the
// attempt, which was asked for the charge's amount.
export class PaymentCallbackRequest {
  @ApiProperty({ example: 'sim-pay-0a1b2c.succeeded' })
  @IsString()
  @MaxLength(200)
  eventId!: string;

  @ApiProperty({
    enum: PAYMENT_CALLBACK_TYPES,
    description: 'payment.returned: a collected debit sent back by the debtor bank',
  })
  @IsIn(PAYMENT_CALLBACK_TYPES)
  type!: PaymentCallbackType;

  @ApiProperty({ example: 'sim-pay-0a1b2c' })
  @IsString()
  @MaxLength(200)
  paymentId!: string;

  @ApiProperty({ description: 'The idempotency key Tramo sent: <chargeId>.<attempt>' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\d{1,4}$/, {
    message: 'reference must be an attempt key as <chargeId>.<attempt>',
  })
  reference!: string;

  @ApiPropertyOptional({ example: 'insufficient_funds' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  failureReason?: string;

  @ApiPropertyOptional({
    example: 'MD06',
    description: 'payment.returned only, and required there: the ISO 20022 return reason code',
  })
  @ValidateIf((body: PaymentCallbackRequest) => body.type === 'payment.returned')
  @Matches(/^[A-Z0-9]{4}$/, { message: 'returnReason must be a four-character reason code' })
  returnReason?: string;

  @ApiProperty({ example: '2026-11-12T08:00:02Z' })
  @IsISO8601({ strict: true })
  occurredAt!: string;
}

export class MandateResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ example: 'TRAMO-0199A3C4D5E6F708' })
  reference!: string;

  @ApiProperty({ example: 'ES76 **** **** **** **** 5766' })
  ibanMasked!: string;

  @ApiProperty({ enum: ['active', 'revoked'] })
  status!: 'active' | 'revoked';

  @ApiProperty()
  signedAt!: Date;
}

export class IncomeDeclarationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ example: '2026-11' })
  period!: string;

  @ApiProperty({ example: 2_150_00 })
  grossMonthlyIncomeCents!: number;

  @ApiProperty({ enum: ['self', 'employment_provider'] })
  source!: 'self' | 'employment_provider';

  @ApiProperty()
  declaredAt!: Date;
}

export class ChargeResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ enum: ['installment', 'isa', 'payoff'] })
  kind!: ChargeKind;

  @ApiProperty({ nullable: true, type: Number, example: 3 })
  installmentNumber!: number | null;

  @ApiProperty({ example: '2026-12' })
  period!: string;

  @ApiProperty({ example: 337_50 })
  amountCents!: number;

  @ApiProperty({ example: '2026-12-12' })
  dueDate!: string;

  @ApiProperty({ enum: CHARGE_STATUSES })
  status!: ChargeStatus;

  @ApiProperty({ example: 1 })
  attempts!: number;

  @ApiProperty({ nullable: true, type: String, example: 'insufficient_funds' })
  lastFailureReason!: string | null;

  @ApiProperty({ nullable: true, type: Date })
  paidAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class ChargePageResponse {
  @ApiProperty({ type: [ChargeResponse] })
  data!: readonly ChargeResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

class LedgerEntryResponse {
  @ApiProperty()
  occurredAt!: Date;

  @ApiProperty({ enum: ['charge', 'payment', 'return', 'write_off', 'cancellation'] })
  type!: string;

  @ApiProperty({ format: 'uuid' })
  chargeId!: string;

  @ApiProperty({ example: 'Instalment due 2026-12-12' })
  description!: string;

  @ApiProperty({
    example: 337_50,
    description: 'Positive owed (a charge, a returned payment), negative paid or no longer owed',
  })
  amountCents!: number;

  @ApiProperty({ example: 337_50 })
  balanceCents!: number;
}

export class StatementResponse {
  @ApiProperty({ format: 'uuid' })
  contractId!: string;

  @ApiProperty({ type: [LedgerEntryResponse] })
  entries!: readonly LedgerEntryResponse[];

  @ApiProperty({ example: 0, description: 'What the student owes now' })
  balanceCents!: number;
}

export class BillingRunResponse {
  @ApiProperty({ example: '2026-12-01' })
  asOf!: string;

  @ApiProperty()
  plansBilled!: number;

  @ApiProperty()
  chargesCreated!: number;

  @ApiProperty({ type: [String], description: 'Plans whose billing failed; run again to retry' })
  failedContractIds!: readonly string[];

  @ApiProperty()
  collectionsSubmitted!: number;

  @ApiProperty({ type: [String], description: 'Charges not submitted; run again to retry' })
  failedChargeIds!: readonly string[];
}

export class DunningRunResponse {
  @ApiProperty({ example: '2026-12-13' })
  asOf!: string;

  @ApiProperty()
  chargesReviewed!: number;

  @ApiProperty()
  retries!: number;

  @ApiProperty({ type: [String], description: 'Charges not dunned; run again to retry' })
  failedChargeIds!: readonly string[];
}

export class PaymentCallbackResponse {
  @ApiProperty({ format: 'uuid', description: 'The charge the collection belongs to' })
  id!: string;

  @ApiProperty({ enum: CHARGE_STATUSES })
  status!: ChargeStatus;
}
