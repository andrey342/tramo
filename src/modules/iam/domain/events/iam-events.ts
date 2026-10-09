import { type ApiKeyScope, type DomainEvent, type Role } from '@shared/domain';

// Published contract of the iam module: other modules subscribe to these by event type and read
// the payload, never the aggregates. Payloads are type aliases (not interfaces) so they satisfy
// the JSON payload constraint of DomainEvent.
export const IamEvents = {
  StudentRegistered: 'StudentRegistered',
  CenterUserCreated: 'CenterUserCreated',
  ApiKeyIssued: 'ApiKeyIssued',
  ApiKeyRevoked: 'ApiKeyRevoked',
  RefreshTokenReuseDetected: 'RefreshTokenReuseDetected',
} as const;

export type StudentRegisteredPayload = {
  readonly userId: string;
  readonly email: string;
};

export type CenterUserCreatedPayload = {
  readonly userId: string;
  readonly email: string;
  readonly centerId: string;
  readonly roles: readonly Role[];
};

export type ApiKeyIssuedPayload = {
  readonly apiKeyId: string;
  readonly centerId: string;
  readonly prefix: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly issuedBy: string;
};

export type ApiKeyRevokedPayload = {
  readonly apiKeyId: string;
  readonly centerId: string;
};

export type RefreshTokenReuseDetectedPayload = {
  readonly userId: string;
  readonly familyId: string;
  readonly revokedTokens: number;
};

export type StudentRegistered = DomainEvent<StudentRegisteredPayload>;
export type CenterUserCreated = DomainEvent<CenterUserCreatedPayload>;
export type ApiKeyIssued = DomainEvent<ApiKeyIssuedPayload>;
export type ApiKeyRevoked = DomainEvent<ApiKeyRevokedPayload>;
export type RefreshTokenReuseDetected = DomainEvent<RefreshTokenReuseDetectedPayload>;
