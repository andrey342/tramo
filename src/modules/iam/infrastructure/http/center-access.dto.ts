import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { API_KEY_SCOPES, type ApiKeyScope } from '@shared/domain';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../domain';

export class CreateCenterUserRequest {
  @ApiProperty({ example: 'admissions@bootcamp.example' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class CenterUserCreatedResponse {
  @ApiProperty({ format: 'uuid' })
  userId!: string;
}

export class IssueApiKeyRequest {
  @ApiProperty({ example: 'Admissions system' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ isArray: true, enum: API_KEY_SCOPES, example: ['applications:write'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: ApiKeyScope[];
}

export class ApiKeyResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Visible part of the key, for identifying it in listings and logs' })
  prefix!: string;

  @ApiProperty({ isArray: true, enum: API_KEY_SCOPES })
  scopes!: readonly ApiKeyScope[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  lastUsedAt!: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  revokedAt!: Date | null;
}

export class IssuedApiKeyResponse extends ApiKeyResponse {
  @ApiProperty({
    description:
      'Send as the X-Api-Key header. Shown only in this response; it cannot be recovered.',
  })
  key!: string;
}
