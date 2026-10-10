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

// While Tramo has a center suspended, only Tramo's staff change what it offers.
export class CenterSuspendedError extends DomainError {
  readonly code = 'center_suspended';
  readonly category = 'forbidden';

  constructor(centerId: string) {
    super('The training center is suspended; its programs cannot be changed.', { centerId });
  }
}

export class InvalidPlatformFeeError extends DomainError {
  readonly code = 'invalid_platform_fee';
  readonly category = 'rule_violation';

  constructor(maxPercent: number) {
    super(`The platform fee must be between 0 % and ${String(maxPercent)} %.`, { maxPercent });
  }
}

export class InvalidFinancingOptionError extends DomainError {
  readonly code = 'invalid_financing_option';
  readonly category = 'rule_violation';

  constructor(reason: string) {
    super(`Invalid financing option: ${reason}.`, { reason });
  }
}

// Programs are published once they are something a student can actually finance.
export class ProgramNotPublishableError extends DomainError {
  readonly code = 'program_not_publishable';
  readonly category = 'rule_violation';

  constructor(reason: string) {
    super(`The program cannot be published: ${reason}.`, { reason });
  }
}
