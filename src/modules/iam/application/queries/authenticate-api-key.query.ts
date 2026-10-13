import { timingSafeEqual } from 'node:crypto';

import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { API_KEY_FORMAT, API_KEY_REPOSITORY, type ApiKeyRepository } from '../../domain';
import {
  CENTER_DIRECTORY,
  type CenterDirectory,
  CREDENTIAL_GENERATOR,
  type CredentialGenerator,
} from '../ports/iam-ports';

export class AuthenticateApiKeyQuery extends Query<Principal | null> {
  constructor(readonly presentedKey: string) {
    super();
  }
}

// Resolves an X-Api-Key header to a principal, or null when the key is unknown, malformed,
// revoked or expired, or its center is suspended or gone. The guard turns null into one generic
// 401 so the reason is not disclosed.
//
// Suspending a center revokes its keys through the outbox, seconds later or, while the worker is
// behind, minutes later; the center is read here on every request so a suspended center's keys
// stop at once. It is one lookup by primary key, made only once the secret matched.
@QueryHandler(AuthenticateApiKeyQuery)
export class AuthenticateApiKeyHandler implements IQueryHandler<AuthenticateApiKeyQuery> {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CREDENTIAL_GENERATOR) private readonly credentials: CredentialGenerator,
    @Inject(CENTER_DIRECTORY) private readonly centers: CenterDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute({ presentedKey }: AuthenticateApiKeyQuery): Promise<Principal | null> {
    const prefix = API_KEY_FORMAT.exec(presentedKey)?.[1];
    if (!prefix) {
      return null;
    }
    const apiKey = await this.apiKeys.findByPrefix(prefix);
    const now = this.clock.now();
    if (!apiKey?.isUsableAt(now)) {
      return null;
    }
    // Compared as text, not decoded: decoding a malformed value would yield an empty buffer that
    // equals any other empty buffer.
    const presented = Buffer.from(this.credentials.hash(presentedKey), 'utf8');
    const stored = Buffer.from(apiKey.secretHash, 'utf8');
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      return null;
    }
    const center = await this.centers.find(apiKey.centerId);
    if (!center || center.suspended) {
      return null;
    }
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
