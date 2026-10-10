import { DomainError } from '@shared/domain';

export class CenterAlreadyRegisteredError extends DomainError {
  readonly code = 'center_already_registered';
  readonly category = 'conflict';

  constructor(taxId: string) {
    super(`A training center with tax id ${taxId} is already registered.`, { taxId });
  }
}

export class CenterAccessDeniedError extends DomainError {
  readonly code = 'center_access_denied';
  readonly category = 'forbidden';

  constructor(centerId: string) {
    super('You cannot manage this training center.', { centerId });
  }
}

export class InvalidPlatformFeeError extends DomainError {
  readonly code = 'invalid_platform_fee';
  readonly category = 'rule_violation';

  constructor(maxPercent: number) {
    super(`The platform fee must be between 0 % and ${String(maxPercent)} %.`, { maxPercent });
  }
}
