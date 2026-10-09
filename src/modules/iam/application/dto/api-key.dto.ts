import { type ApiKeyScope } from '@shared/domain';

export interface ApiKeySummaryDto {
  readonly id: string;
  readonly centerId: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

// Only returned by the issuing request: the full key is not stored and cannot be shown again.
export interface IssuedApiKeyDto extends ApiKeySummaryDto {
  readonly key: string;
}
