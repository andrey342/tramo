import { type ApiKeyScope, type Role } from '@shared/domain';

export interface SessionTokensDto {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export type CurrentPrincipalDto =
  | {
      readonly kind: 'user';
      readonly id: string;
      readonly email: string;
      readonly roles: readonly Role[];
      readonly centerId: string | null;
    }
  | {
      readonly kind: 'api_key';
      readonly id: string;
      readonly centerId: string;
      readonly scopes: readonly ApiKeyScope[];
    };
