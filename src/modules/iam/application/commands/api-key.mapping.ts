import { type ApiKey } from '../../domain';
import { type ApiKeySummaryDto } from '../dto/api-key.dto';

export function toApiKeySummary(apiKey: ApiKey): ApiKeySummaryDto {
  return {
    id: apiKey.id,
    centerId: apiKey.centerId,
    name: apiKey.name,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
  };
}
