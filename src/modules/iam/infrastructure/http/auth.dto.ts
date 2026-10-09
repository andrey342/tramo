import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

import { type ApiKeyScope, type Role } from '@shared/domain';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../domain';

export class RegisterStudentRequest {
  @ApiProperty({ example: 'ana.garcia@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RegisteredResponse {
  @ApiProperty({ format: 'uuid' })
  userId!: string;
}

export class LoginRequest {
  @ApiProperty({ example: 'ana.garcia@example.com' })
  @IsString()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RefreshTokenRequest {
  @ApiProperty({ description: 'Refresh token from the last login or refresh' })
  @IsString()
  @MaxLength(256)
  refreshToken!: string;
}

export class SessionTokensResponse {
  @ApiProperty({ description: 'Bearer token for the Authorization header' })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Seconds until the access token expires', example: 900 })
  expiresIn!: number;

  @ApiProperty()
  accessTokenExpiresAt!: Date;

  @ApiProperty({ description: 'Single use: every refresh returns a new one' })
  refreshToken!: string;

  @ApiProperty()
  refreshTokenExpiresAt!: Date;
}

export class CurrentPrincipalResponse {
  @ApiProperty({ enum: ['user', 'api_key'] })
  kind!: 'user' | 'api_key';

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty({
    required: false,
    isArray: true,
    enum: ['student', 'center_admin', 'ops', 'admin'],
  })
  roles?: readonly Role[];

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  centerId?: string | null;

  @ApiProperty({ required: false, isArray: true, type: String })
  scopes?: readonly ApiKeyScope[];
}
