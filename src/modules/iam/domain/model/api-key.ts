import { AggregateRoot, type ApiKeyScope, InvalidValueError } from '@shared/domain';

import { IamEvents } from '../events/iam-events';

export interface ApiKeyProps {
  readonly centerId: string;
  readonly name: string;
  // Short, non-secret part shown in listings and used to find the key; the rest is only hashed.
  readonly prefix: string;
  readonly secretHash: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

// Recording every use would turn each authenticated request into a write.
const LAST_USED_RESOLUTION_MS = 60_000;

export class ApiKey extends AggregateRoot {
  private constructor(
    id: string,
    private props: ApiKeyProps,
  ) {
    super(id);
  }

  static issue(input: {
    id: string;
    centerId: string;
    name: string;
    prefix: string;
    secretHash: string;
    scopes: readonly ApiKeyScope[];
    issuedBy: string;
    now: Date;
  }): ApiKey {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) {
      throw new InvalidValueError('name', 'API key name must be 1 to 100 characters.');
    }
    if (input.scopes.length === 0) {
      throw new InvalidValueError('scopes', 'An API key needs at least one scope.');
    }
    const key = new ApiKey(input.id, {
      centerId: input.centerId,
      name,
      prefix: input.prefix,
      secretHash: input.secretHash,
      scopes: [...new Set(input.scopes)],
      createdBy: input.issuedBy,
      createdAt: input.now,
      lastUsedAt: null,
      revokedAt: null,
    });
    key.record({
      eventType: IamEvents.ApiKeyIssued,
      aggregateType: 'ApiKey',
      aggregateId: key.id,
      occurredAt: input.now,
      payload: {
        apiKeyId: key.id,
        centerId: input.centerId,
        prefix: input.prefix,
        scopes: key.scopes,
        issuedBy: input.issuedBy,
      },
    });
    return key;
  }

  static reconstitute(id: string, props: ApiKeyProps): ApiKey {
    return new ApiKey(id, props);
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get name(): string {
    return this.props.name;
  }

  get prefix(): string {
    return this.props.prefix;
  }

  get secretHash(): string {
    return this.props.secretHash;
  }

  get scopes(): readonly ApiKeyScope[] {
    return this.props.scopes;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get isActive(): boolean {
    return this.props.revokedAt === null;
  }

  // Revoking twice is a no-op, so retries and double clicks are harmless.
  revoke(now: Date): void {
    if (!this.isActive) {
      return;
    }
    this.props = { ...this.props, revokedAt: now };
    this.record({
      eventType: IamEvents.ApiKeyRevoked,
      aggregateType: 'ApiKey',
      aggregateId: this.id,
      occurredAt: now,
      payload: { apiKeyId: this.id, centerId: this.props.centerId },
    });
  }

  // Returns whether the change is worth persisting.
  recordUse(now: Date): boolean {
    const last = this.props.lastUsedAt;
    if (last && now.getTime() - last.getTime() < LAST_USED_RESOLUTION_MS) {
      return false;
    }
    this.props = { ...this.props, lastUsedAt: now };
    return true;
  }
}
