import { DomainError } from '@shared/domain';

export class ProductNotOfferedError extends DomainError {
  readonly code = 'product_not_offered';
  readonly category = 'rule_violation';

  constructor(reason: string) {
    super(`The program does not offer this financing: ${reason}.`, { reason });
  }
}

export class ProgramNotAvailableError extends DomainError {
  readonly code = 'program_not_available';
  readonly category = 'rule_violation';

  constructor(programId: string) {
    super('The program is not open for applications.', { programId });
  }
}

export class ApplicationIncompleteError extends DomainError {
  readonly code = 'application_incomplete';
  readonly category = 'rule_violation';

  constructor(missing: readonly string[]) {
    super(`The application is missing: ${missing.join(', ')}.`, { missing: [...missing] });
  }
}

export class ApplicationAccessDeniedError extends DomainError {
  readonly code = 'application_access_denied';
  readonly category = 'forbidden';

  constructor() {
    super('You cannot act on this application.');
  }
}

export class StudentNotFoundError extends DomainError {
  readonly code = 'student_not_found';
  readonly category = 'rule_violation';

  constructor() {
    super('No student account matches that email; the student has to sign up first.');
  }
}

export class InvalidRiskPolicyError extends DomainError {
  readonly code = 'invalid_risk_policy';
  readonly category = 'rule_violation';

  constructor(reason: string) {
    super(`Invalid risk policy: ${reason}.`, { reason });
  }
}
