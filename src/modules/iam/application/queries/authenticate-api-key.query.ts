import { timingSafeEqual } from 'node:crypto';

import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { API_KEY_FORMAT, API_KEY_REPOSITORY, type ApiKeyRepository } from '../../domain';
import { CREDENTIAL_GENERATOR, type CredentialGenerator } from '../ports/iam-ports';

export class AuthenticateApiKeyQuery extends Query<Principal | null> {
  constructor(readonly presentedKey: string) {
    super();
  }
}

// Resolves an X-Api-Key header to a principal, or null when the key is unknown, malformed or
// revoked. The guard turns null into one generic 401 so the reason is not disclosed.
@QueryHandler(AuthenticateApiKeyQuery)
export class AuthenticateApiKeyHandler implements IQueryHandler<AuthenticateApiKeyQuery> {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CREDENTIAL_GENERATOR) private readonly credentials: CredentialGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute({ presentedKey }: AuthenticateApiKeyQuery): Promise<Principal | null> {
    const prefix = API_KEY_FORMAT.exec(presentedKey)?.[1];
    if (!prefix) {
      return null;
    }
    const apiKey = await this.apiKeys.findByPrefix(prefix);
    if (!apiKey?.isActive) {
      return null;
    }
    // Compared as text, not decoded: decoding a malformed value would yield an empty buffer that
    // equals any other empty buffer.
    const presented = Buffer.from(this.credentials.hash(presentedKey), 'utf8');
    const stored = Buffer.from(apiKey.secretHash, 'utf8');
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      return null;
    }
    const now = this.clock.now();
    if (apiKey.recordUse(now)) {
      await this.apiKeys.recordUse(apiKey.id, now);
    }
    return {
      kind: 'api_key',
      apiKeyId: apiKey.id,
      centerId: apiKey.centerId,
      scopes: apiKey.scopes,
    };
  }
}
