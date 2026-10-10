import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CursorPageQueryDto } from '@shared/infrastructure/http';

import {
  FINANCING_LIMITS,
  type FinancingProduct,
  PROGRAM_LIMITS,
  PROGRAM_MODALITIES,
  type ProgramModality,
  type ProgramStatus,
} from '../../domain';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Amounts the domain does not bound (salaries, incomes) still have to fit an integer column.
const MAX_CENTS = 10_000_000;
const MAX_PRICE_CENTS = PROGRAM_LIMITS.maxPriceCents;

export class InstallmentsRequest {
  @ApiProperty({
    example: [12, 24, 36],
    description: `Loan terms in months, ${String(FINANCING_LIMITS.minTermMonths)} to ${String(FINANCING_LIMITS.maxTermMonths)}`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FINANCING_LIMITS.maxTerms)
  @IsInt({ each: true })
  allowedTerms!: number[];

  @ApiProperty({ example: 750, description: 'Annual interest rate in basis points (750 = 7.5 %)' })
  @IsInt()
  @Min(0)
  @Max(FINANCING_LIMITS.maxAnnualRateBps)
  annualRateBasisPoints!: number;
}

export class IsaRequest {
  @ApiProperty({
    example: 1_000,
    description: 'Share of monthly income in basis points (1000 = 10 %)',
  })
  @IsInt()
  @Min(1)
  @Max(FINANCING_LIMITS.maxIncomeShareBps)
  incomeShareBasisPoints!: number;

  @ApiProperty({
    example: 150_000,
    description: 'Payments start above this gross monthly income (cents)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  minMonthlyIncomeCents!: number;

  @ApiProperty({ example: 36 })
  @IsInt()
  @Min(1)
  @Max(FINANCING_LIMITS.maxIsaPayments)
  maxPayments!: number;

  @ApiProperty({
    example: 1.5,
    description: 'Total paid is capped at this multiple of the price (1.0 to 2.0)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(2)
  capMultiplier!: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  @Max(FINANCING_LIMITS.maxGraceMonths)
  graceMonths!: number;
}

export class FinancingRequest {
  @ApiPropertyOptional({ type: InstallmentsRequest, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => InstallmentsRequest)
  installments?: InstallmentsRequest | null;

  @ApiPropertyOptional({ type: IsaRequest, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => IsaRequest)
  isa?: IsaRequest | null;
}

export class UpdateProgramRequest {
  @ApiPropertyOptional({ example: 'Full Stack Bootcamp' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PROGRAM_LIMITS.maxNameLength)
  name?: string;

  @ApiPropertyOptional({ enum: PROGRAM_MODALITIES })
  @IsOptional()
  @IsIn(PROGRAM_MODALITIES)
  modality?: ProgramModality;

  @ApiPropertyOptional({ example: 750_000, description: 'Price in cents (EUR)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  priceCents?: number;

  @ApiPropertyOptional({ example: 16 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PROGRAM_LIMITS.maxDurationWeeks)
  durationWeeks?: number;

  @ApiPropertyOptional({ example: ['2027-01-11', '2027-04-05'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROGRAM_LIMITS.maxStartDates)
  @Matches(ISO_DATE, { each: true, message: 'startDates must be YYYY-MM-DD dates' })
  startDates?: string[];

  @ApiPropertyOptional({
    example: 8_500,
    description: 'Graduates employed within six months, basis points',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  employabilityRateBasisPoints?: number;

  @ApiPropertyOptional({
    example: 2_800_000,
    description: 'Average gross annual salary of graduates, cents',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  avgStartingSalaryCents?: number;

  @ApiPropertyOptional({ type: FinancingRequest, description: 'Replaces every financing option' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FinancingRequest)
  financing?: FinancingRequest;

  @ApiPropertyOptional({ enum: ['published', 'archived'] })
  @IsOptional()
  @IsIn(['published', 'archived'])
  status?: 'published' | 'archived';
}

export class CreateProgramRequest {
  @ApiProperty({ example: 'Full Stack Bootcamp' })
  @IsString()
  @MinLength(1)
  @MaxLength(PROGRAM_LIMITS.maxNameLength)
  name!: string;

  @ApiProperty({ enum: PROGRAM_MODALITIES })
  @IsIn(PROGRAM_MODALITIES)
  modality!: ProgramModality;

  @ApiProperty({ example: 750_000, description: 'Price in cents (EUR)' })
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  priceCents!: number;

  @ApiProperty({ example: 16 })
  @IsInt()
  @Min(1)
  @Max(PROGRAM_LIMITS.maxDurationWeeks)
  durationWeeks!: number;

  @ApiProperty({ example: ['2027-01-11', '2027-04-05'] })
  @IsArray()
  @ArrayMaxSize(PROGRAM_LIMITS.maxStartDates)
  @Matches(ISO_DATE, { each: true, message: 'startDates must be YYYY-MM-DD dates' })
  startDates!: string[];

  @ApiProperty({
    example: 8_500,
    description: 'Graduates employed within six months, basis points',
  })
  @IsInt()
  @Min(0)
  @Max(10_000)
  employabilityRateBasisPoints!: number;

  @ApiProperty({
    example: 2_800_000,
    description: 'Average gross annual salary of graduates, cents',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  avgStartingSalaryCents!: number;

  @ApiProperty({ type: FinancingRequest })
  @IsDefined()
  @ValidateNested()
  @Type(() => FinancingRequest)
  financing!: FinancingRequest;
}

export class ListProgramsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({ enum: PROGRAM_MODALITIES })
  @IsOptional()
  @IsIn(PROGRAM_MODALITIES)
  modality?: ProgramModality;

  @ApiPropertyOptional({
    enum: ['installments', 'isa'],
    description: 'Programs offering this financing',
  })
  @IsOptional()
  @IsIn(['installments', 'isa'])
  product?: FinancingProduct;

  @ApiPropertyOptional({ description: 'Minimum price in cents' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  minPriceCents?: number;

  @ApiPropertyOptional({ description: 'Maximum price in cents' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  maxPriceCents?: number;
}

class InstallmentsResponse {
  @ApiProperty({ example: [12, 24] })
  allowedTerms!: readonly number[];

  @ApiProperty({ example: 750 })
  annualRateBasisPoints!: number;
}

class IsaResponse {
  @ApiProperty({ example: 1_000 })
  incomeShareBasisPoints!: number;

  @ApiProperty({ example: 150_000 })
  minMonthlyIncomeCents!: number;

  @ApiProperty({ example: 36 })
  maxPayments!: number;

  @ApiProperty({ example: 1.5 })
  capMultiplier!: number;

  @ApiProperty({ example: 3 })
  graceMonths!: number;
}

class FinancingResponse {
  @ApiProperty({ type: InstallmentsResponse, nullable: true })
  installments!: InstallmentsResponse | null;

  @ApiProperty({ type: IsaResponse, nullable: true })
  isa!: IsaResponse | null;
}

export class ProgramResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: PROGRAM_MODALITIES })
  modality!: ProgramModality;

  @ApiProperty({ example: 750_000 })
  priceCents!: number;

  @ApiProperty({ example: 'EUR' })
  currency!: 'EUR';

  @ApiProperty({ example: 16 })
  durationWeeks!: number;

  @ApiProperty({ example: ['2027-01-11'] })
  startDates!: readonly string[];

  @ApiProperty({ example: 8_500 })
  employabilityRateBasisPoints!: number;

  @ApiProperty({ example: 2_800_000 })
  avgStartingSalaryCents!: number;

  @ApiProperty({ type: FinancingResponse })
  financing!: FinancingResponse;

  @ApiProperty({ enum: ['installments', 'isa'], isArray: true })
  products!: readonly FinancingProduct[];

  @ApiProperty({ enum: ['draft', 'published', 'archived'] })
  status!: ProgramStatus;

  @ApiProperty({ nullable: true, type: Date })
  publishedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class CatalogProgramResponse extends ProgramResponse {
  @ApiProperty({ example: 'Codeworks Barcelona' })
  centerName!: string;
}

export class ProgramPageResponse {
  @ApiProperty({ type: [CatalogProgramResponse] })
  data!: readonly CatalogProgramResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
