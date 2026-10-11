import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WeightsRequest {
  @ApiProperty({ example: 4_000 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  employability!: number;

  @ApiProperty({ example: 2_500 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  employmentHistory!: number;

  @ApiProperty({ example: 2_000 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  affordability!: number;

  @ApiProperty({ example: 1_500 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  bureau!: number;
}

// Anything left out stays as in the version in force.
export class RevisePolicyRequest {
  @ApiPropertyOptional({ example: 1_200_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_00)
  maxFinanceableCents?: number;

  @ApiPropertyOptional({ example: 18 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(99)
  minAgeYears?: number;

  @ApiPropertyOptional({ example: ['ES'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @Matches(/^[A-Za-z]{2}$/, { each: true, message: 'countries must be two-letter codes' })
  allowedResidenceCountries?: string[];

  @ApiPropertyOptional({
    type: WeightsRequest,
    description: 'Basis points; the four must add up to 10000',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightsRequest)
  weightsBasisPoints?: WeightsRequest;

  @ApiPropertyOptional({ example: 70 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  approveThreshold?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  reviewThreshold?: number;
}

class WeightsResponse {
  @ApiProperty({ example: 4_000 })
  employability!: number;

  @ApiProperty({ example: 2_500 })
  employmentHistory!: number;

  @ApiProperty({ example: 2_000 })
  affordability!: number;

  @ApiProperty({ example: 1_500 })
  bureau!: number;
}

export class RiskPolicyResponse {
  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ example: 1_200_000 })
  maxFinanceableCents!: number;

  @ApiProperty({ example: 18 })
  minAgeYears!: number;

  @ApiProperty({ example: ['ES'] })
  allowedResidenceCountries!: readonly string[];

  @ApiProperty({ type: WeightsResponse })
  weightsBasisPoints!: WeightsResponse;

  @ApiProperty({ example: 70 })
  approveThreshold!: number;

  @ApiProperty({ example: 50 })
  reviewThreshold!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ example: 'system' })
  createdBy!: string;
}
