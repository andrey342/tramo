import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { VAT_COUNTRIES, type VatCountry } from '@shared/domain';

import { type CenterStatus, MAX_PLATFORM_FEE_BPS, type VatValidationStatus } from '../../domain';

export class RegisterTrainingCenterRequest {
  @ApiProperty({ example: 'Codeworks Barcelona' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: VAT_COUNTRIES, example: 'ES' })
  @IsIn(VAT_COUNTRIES)
  country!: VatCountry;

  @ApiProperty({
    example: 'B12345678',
    description:
      'National VAT number, with or without the country prefix. With VIES_MODE=test, 100 is valid, 200 invalid and any other number looks like a VIES outage.',
  })
  @IsString()
  @MaxLength(20)
  taxId!: string;

  @ApiProperty({
    example: 'ES91 2100 0418 4502 0005 1332',
    description: 'Account disbursements are paid into',
  })
  @IsString()
  @MaxLength(42)
  payoutIban!: string;

  @ApiProperty({
    example: 500,
    description: "Tramo's commission in basis points (500 = 5 %), at most 3000",
  })
  @IsInt()
  @Min(0)
  @Max(MAX_PLATFORM_FEE_BPS)
  platformFeeBasisPoints!: number;
}

export class CenterRegisteredResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

export class UpdateTrainingCenterRequest {
  @ApiPropertyOptional({ example: 'Codeworks Madrid' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 650, maximum: MAX_PLATFORM_FEE_BPS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PLATFORM_FEE_BPS)
  platformFeeBasisPoints?: number;

  @ApiPropertyOptional({ example: 'DE89 3704 0044 0532 0130 00' })
  @IsOptional()
  @IsString()
  @MaxLength(42)
  payoutIban?: string;

  @ApiPropertyOptional({
    enum: ['suspended', 'active'],
    description: '`suspended` (needs suspensionReason) or `active` to reinstate a suspended center',
  })
  @IsOptional()
  @IsIn(['suspended', 'active'])
  status?: 'suspended' | 'active';

  @ApiPropertyOptional({ example: 'Chargeback investigation' })
  @ValidateIf((request: UpdateTrainingCenterRequest) => request.status === 'suspended')
  @IsString()
  @Matches(/\S/, { message: 'suspensionReason must not be blank' })
  @MaxLength(500)
  suspensionReason?: string;
}

class VatValidationResponse {
  @ApiProperty({ enum: ['valid', 'invalid', 'unverified'] })
  status!: VatValidationStatus;

  @ApiProperty()
  checkedAt!: Date;

  @ApiProperty({ example: 'vies' })
  provider!: string;

  @ApiProperty({ nullable: true, type: String, example: 'CODEWORKS SL' })
  registeredName!: string | null;
}

export class TrainingCenterResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: VAT_COUNTRIES })
  country!: string;

  @ApiProperty({ example: 'ESB12345678' })
  taxId!: string;

  @ApiProperty({ enum: ['pending_verification', 'active', 'suspended'] })
  status!: CenterStatus;

  @ApiProperty({ type: VatValidationResponse, nullable: true })
  vatValidation!: VatValidationResponse | null;

  @ApiProperty({ example: 'ES91 **** 1332' })
  payoutIbanMasked!: string;

  @ApiProperty({ example: 500 })
  platformFeeBasisPoints!: number;

  @ApiProperty()
  createdAt!: Date;
}
