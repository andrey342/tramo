import { DomainError } from '@shared/domain';

export class BillingAccessDeniedError extends DomainError {
  readonly code = 'billing_access_denied';
  readonly category = 'forbidden';

  constructor() {
    super('You cannot act on the billing of this contract.');
  }
}

export class ContractNotRepayingError extends DomainError {
  readonly code = 'contract_not_repaying';
  readonly category = 'rule_violation';

  constructor(status: string) {
    super(`The contract is ${status}, not being repaid.`, { status });
  }
}

export class NotAnIncomeShareError extends DomainError {
  readonly code = 'not_an_income_share';
  readonly category = 'rule_violation';

  constructor() {
    super('Income is declared for income share agreements only.');
  }
}

export class IncomeAlreadyDeclaredError extends DomainError {
  readonly code = 'income_already_declared';
  readonly category = 'conflict';

  constructor(period: string) {
    super(`Income for ${period} has already been declared.`, { period });
  }
}

export class InvalidPeriodError extends DomainError {
  readonly code = 'invalid_period';
  readonly category = 'validation';

  constructor(reason: string) {
    super(`The period is not valid: ${reason}.`, { reason });
  }
}

// A payment provider callback about an attempt the charge does not have.
export class UnknownCollectionAttemptError extends DomainError {
  readonly code = 'unknown_collection_attempt';
  readonly category = 'conflict';

  constructor(reference: string) {
    super('No collection attempt matches this reference.', { reference });
  }
}

// The provider reports a payment other than the one it accepted for the attempt.
export class PaymentMismatchError extends DomainError {
  readonly code = 'payment_mismatch';
  readonly category = 'conflict';

  constructor(reference: string) {
    super('The payment does not match the one accepted for this attempt.', { reference });
  }
}

export class MandateMissingError extends DomainError {
  readonly code = 'mandate_missing';
  readonly category = 'rule_violation';

  constructor(contractId: string) {
    super('The contract has no active direct debit mandate.', { contractId });
  }
}

// Two runs created the same charge at once (unique per contract and reference); the next run
// finds it.
export class ConcurrentChargeError extends DomainError {
  readonly code = 'concurrent_charge';
  readonly category = 'conflict';

  constructor(reference: string) {
    super(`The charge ${reference} was created by another run.`, { reference });
  }
}
