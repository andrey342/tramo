import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { CursorPageQueryDto } from '@shared/infrastructure/http';

import { type RequestedProductDto } from '../../application/dto/application.dto';
import {
  APPLICATION_STATUSES,
  type ApplicationOrigin,
  type ApplicationStatus,
  type DecisionOutcome,
  EMPLOYMENT_STATUSES,
  type EmploymentStatus,
  HARD_RULES,
  type HardRule,
  SCORE_FACTORS,
  type ScoreFactorName,
} from '../../domain';

const MAX_MONTHLY_INCOME_CENTS = 100_000_00;

export class ProductRequest {
  @ApiProperty({ enum: ['installments', 'isa'] })
  @IsIn(['installments', 'isa'])
  kind!: 'installments' | 'isa';

  @ApiPropertyOptional({
    example: 24,
    description: 'Months, one of the terms the program offers; only for instalments',
  })
  @ValidateIf((product: ProductRequest) => product.kind === 'installments')
  @IsInt()
  @Min(1)
  @Max(120)
  termMonths?: number;

  toProduct(): RequestedProductDto {
    return this.kind === 'isa'
      ? { kind: 'isa' }
      : { kind: 'installments', termMonths: this.termMonths ?? 0 };
  }
}

// Absent fields are left as they are; a field sent as null is invalid (not "clear it").
const isGiven = (_: object, value: unknown): boolean => value !== undefined;

export class ProfileRequest {
  @ApiPropertyOptional({ example: '1998-05-20' })
  @ValidateIf(isGiven)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a YYYY-MM-DD date' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '12345678Z', description: 'Spanish DNI or NIE' })
  @ValidateIf(isGiven)
  @IsString()
  @MaxLength(20)
  nationalId?: string;

  @ApiPropertyOptional({ example: 'ES', description: 'ISO 3166-1 alpha-2' })
  @ValidateIf(isGiven)
  @Matches(/^[A-Za-z]{2}$/, { message: 'residenceCountry must be a two-letter country code' })
  residenceCountry?: string;

  @ApiPropertyOptional({ example: 180_000, description: 'Gross monthly income in cents' })
  @ValidateIf(isGiven)
  @IsInt()
  @Min(0)
  @Max(MAX_MONTHLY_INCOME_CENTS)
  declaredMonthlyIncomeCents?: number;

  @ApiPropertyOptional({ enum: EMPLOYMENT_STATUSES })
  @ValidateIf(isGiven)
  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus?: EmploymentStatus;
}

export class StartApplicationRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  programId!: string;

  @ApiProperty({ type: ProductRequest })
  @IsDefined()
  @ValidateNested()
  @Type(() => ProductRequest)
  product!: ProductRequest;

  @ApiPropertyOptional({ type: ProfileRequest, description: 'May be completed later' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileRequest)
  profile?: ProfileRequest;

  @ApiPropertyOptional({
    example: 'ana.garcia@example.com',
    description: 'Required for a training center (API key): the student it applies for',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  studentEmail?: string;
}

export class UpdateApplicationRequest {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  programId?: string;

  @ApiPropertyOptional({ type: ProductRequest })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductRequest)
  product?: ProductRequest;

  @ApiPropertyOptional({ type: ProfileRequest })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileRequest)
  profile?: ProfileRequest;
}

export class DecideApplicationRequest {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  outcome!: 'approved' | 'rejected';

  @ApiProperty({ example: 'Stable job for two years; payment is 18 % of income.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ListApplicationsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;
}

class ProductResponse {
  @ApiProperty({ enum: ['installments', 'isa'] })
  kind!: 'installments' | 'isa';

  @ApiPropertyOptional({ example: 24 })
  termMonths?: number;
}

class ProfileResponse {
  @ApiProperty({ nullable: true, type: String, example: '1998-05-20' })
  dateOfBirth!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '*****678Z' })
  nationalIdMasked!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'ES' })
  residenceCountry!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 180_000 })
  declaredMonthlyIncomeCents!: number | null;

  @ApiProperty({ nullable: true, enum: EMPLOYMENT_STATUSES })
  employmentStatus!: EmploymentStatus | null;
}

export class ApplicationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  applicantId!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({ enum: ['student', 'center'] })
  origin!: ApplicationOrigin;

  @ApiProperty({ format: 'uuid' })
  programId!: string;

  @ApiProperty()
  programName!: string;

  @ApiProperty({ example: 750_000 })
  amountCents!: number;

  @ApiProperty({ example: 'EUR' })
  currency!: 'EUR';

  @ApiProperty({ type: ProductResponse })
  product!: ProductResponse;

  @ApiProperty({
    type: ProfileResponse,
    nullable: true,
    description: 'Personal data: only the student and Tramo staff see it',
  })
  profile!: ProfileResponse | null;

  @ApiProperty({ enum: ['kyc', 'employment', 'bureau'], isArray: true })
  verificationsCompleted!: readonly ('kyc' | 'employment' | 'bureau')[];

  @ApiProperty({ enum: APPLICATION_STATUSES })
  status!: ApplicationStatus;

  @ApiProperty({ nullable: true, type: Number, example: 87.25 })
  score!: number | null;

  @ApiProperty()
  statusChangedAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}

export class ApplicationSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  applicantId!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({ format: 'uuid' })
  programId!: string;

  @ApiProperty()
  programName!: string;

  @ApiProperty({ example: 750_000 })
  amountCents!: number;

  @ApiProperty({ enum: ['installments', 'isa'] })
  product!: 'installments' | 'isa';

  @ApiProperty({ enum: APPLICATION_STATUSES })
  status!: ApplicationStatus;

  @ApiProperty({ nullable: true, type: Number })
  score!: number | null;

  @ApiProperty()
  statusChangedAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}

export class ApplicationPageResponse {
  @ApiProperty({ type: [ApplicationSummaryResponse] })
  data!: readonly ApplicationSummaryResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

class ScoreFactorResponse {
  @ApiProperty({ enum: SCORE_FACTORS })
  name!: ScoreFactorName;

  @ApiProperty({ example: 4_000 })
  weightBasisPoints!: number;

  @ApiProperty({ example: 0.85, description: 'How the applicant does on this factor, 0 to 1' })
  value!: number;

  @ApiProperty({ example: 34, description: 'What the factor adds to the score' })
  points!: number;
}

class ManualDecisionResponse {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  outcome!: 'approved' | 'rejected';

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  decidedAt!: Date;
}

export class DecisionResponse {
  @ApiProperty({ enum: ['approved', 'needs_review', 'rejected'] })
  outcome!: DecisionOutcome;

  @ApiProperty({ example: 87.25 })
  score!: number;

  @ApiProperty({ type: [ScoreFactorResponse] })
  factors!: readonly ScoreFactorResponse[];

  @ApiProperty({ enum: HARD_RULES, isArray: true })
  hardRulesBroken!: readonly HardRule[];

  @ApiProperty({ example: ['Score 87.25 reaches the approval threshold of 70.'] })
  reasons!: readonly string[];

  @ApiProperty({ example: 33_750 })
  estimatedMonthlyPaymentCents!: number;

  @ApiProperty({ example: 1 })
  policyVersion!: number;

  @ApiProperty()
  decidedAt!: Date;

  @ApiProperty({ type: ManualDecisionResponse, nullable: true })
  manualDecision!: ManualDecisionResponse | null;
}
