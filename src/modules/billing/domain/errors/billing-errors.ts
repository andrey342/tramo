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

// The agreement reached its cap, its last payment or the end of its window: no month is charged
// any more, though what was charged may still be being collected.
export class IncomeShareAssessedError extends DomainError {
  readonly code = 'income_share_assessed';
  readonly category = 'rule_violation';

  constructor() {
    super('The agreement charges no more months: its cap, last payment or window was reached.');
  }
}

// The contract was just activated and lending has not opened its plan yet: retry shortly.
export class IncomeSharePlanNotOpenError extends DomainError {
  readonly code = 'plan_not_open';
  readonly category = 'conflict';

  constructor() {
    super('The agreement has no repayment plan yet: it opens shortly after activation.');
  }
}

export class IncomeAlreadyDeclaredError extends DomainError {
  readonly code = 'income_already_declared';
  readonly category = 'conflict';

  constructor(period: string) {
    super(`Income for ${period} has already been declared.`, { period });
  }
}

// A month before the ISA's first one, one whose window closed on the 5th of the next month, or
// one already assessed (paused without a declaration).
export class PeriodNotOpenError extends DomainError {
  readonly code = 'period_not_open';
  readonly category = 'rule_violation';

  constructor(period: string, openFrom: string) {
    super(`Income for ${period} cannot be declared; the first open month is ${openFrom}.`, {
      period,
      openFrom,
    });
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

// A payoff of the contract is being collected or was paid: it covers this charge, which is not
// collected on its own.
export class PayoffInProgressError extends DomainError {
  readonly code = 'payoff_in_progress';
  readonly category = 'conflict';

  constructor(contractId: string) {
    super('A payoff of the contract covers this charge.', { contractId });
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
