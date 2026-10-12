import { DomainError } from '@shared/domain';

export class InvalidContractTermsError extends DomainError {
  readonly code = 'invalid_contract_terms';
  readonly category = 'validation';

  constructor(reason: string) {
    super(`The contract terms are not valid: ${reason}.`, { reason });
  }
}

// A signature callback for another envelope, or for a document other than the one sent: the
// student did not sign this contract.
export class SignatureMismatchError extends DomainError {
  readonly code = 'signature_mismatch';
  readonly category = 'rule_violation';

  constructor(field: 'envelopeId' | 'documentHash') {
    super(`The signature does not match the contract sent (${field}).`, { field });
  }
}

export class ContractAccessDeniedError extends DomainError {
  readonly code = 'contract_access_denied';
  readonly category = 'forbidden';

  constructor() {
    super('You cannot act on this contract.');
  }
}

export class PayoffNotAvailableError extends DomainError {
  readonly code = 'payoff_not_available';
  readonly category = 'rule_violation';

  constructor(reason: string) {
    super(`The contract cannot be paid off: ${reason}.`, { reason });
  }
}

export class PayoffAlreadyRequestedError extends DomainError {
  readonly code = 'payoff_already_requested';
  readonly category = 'conflict';

  constructor() {
    super('A payoff of this contract is already being collected.');
  }
}

export class PeriodAlreadyAssessedError extends DomainError {
  readonly code = 'period_already_assessed';
  readonly category = 'conflict';

  constructor(period: string) {
    super(`The period ${period} has already been assessed.`, { period });
  }
}

export class PlanEndedError extends DomainError {
  readonly code = 'plan_ended';
  readonly category = 'conflict';

  constructor(planId: string) {
    super('The repayment plan has already ended.', { planId });
  }
}
