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

// One open application per student and program: two approved ones could both be accepted, and
// lending would draw up two contracts for one course.
export class ApplicationAlreadyOpenError extends DomainError {
  readonly code = 'application_already_open';
  readonly category = 'conflict';

  constructor(programId: string) {
    super('There is already an open application for this program.', { programId });
  }
}

export class ApplicationIncompleteError extends DomainError {
  readonly code = 'application_incomplete';
  readonly category = 'rule_violation';

  constructor(missing: readonly string[]) {
    super(`The application is missing: ${missing.join(', ')}.`, { missing: [...missing] });
  }
}

// The student states their own personal data and consents to it being checked; a center may only
// pick the program and the financing for them.
export class ProfileFromStudentOnlyError extends DomainError {
  readonly code = 'profile_from_student_only';
  readonly category = 'forbidden';

  constructor() {
    super('Only the student fills in their personal data.');
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
