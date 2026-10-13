// Published contract of the billing module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent. Amounts a student owes or paid travel as
// cents; what they earn (income declarations) never does.
export const BillingEvents = {
  MandateSigned: 'MandateSigned',
  MandateRevoked: 'MandateRevoked',
  ChargeCreated: 'ChargeCreated',
  ChargeDueSoon: 'ChargeDueSoon',
  ChargeSubmitted: 'ChargeSubmitted',
  ChargePaid: 'ChargePaid',
  ChargeFailed: 'ChargeFailed',
  ChargeReturned: 'ChargeReturned',
  ChargeOverdue: 'ChargeOverdue',
  ContractInArrears: 'ContractInArrears',
  ArrearsCleared: 'ArrearsCleared',
  ChargeWrittenOff: 'ChargeWrittenOff',
  ChargeCancelled: 'ChargeCancelled',
  IncomeDeclared: 'IncomeDeclared',
  IncomeDeclarationDue: 'IncomeDeclarationDue',
} as const;

// `accelerated`: the principal of the instalments not billed when a loan defaulted, owed at once
// and written off as it is raised (the debt goes to collections).
export type ChargeKind = 'installment' | 'isa' | 'payoff' | 'accelerated';

export type MandateSignedPayload = {
  readonly mandateId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly mandateReference: string;
};

export type MandateRevokedPayload = {
  readonly mandateId: string;
  readonly contractId: string;
};

export type ChargeCreatedPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly kind: ChargeKind;
  readonly amountCents: number;
  readonly dueDate: string;
};

// Three days before the due date: a reminder for the student.
export type ChargeDueSoonPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly amountCents: number;
  readonly dueDate: string;
};

// A collection attempt was started: a job asks the payment provider, with this key.
export type ChargeSubmittedPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly attemptKey: string;
};

export type ChargePaidPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly kind: ChargeKind;
  // Instalments: which one of the plan's table.
  readonly installmentNumber: number | null;
  readonly amountCents: number;
  // The attempt that collected it: a return of an earlier attempt is not about this payment.
  readonly attempt: number;
  readonly paidAt: string;
};

export type ChargeFailedPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  // A payoff that fails is abandoned (lending withdraws it); other charges are dunned.
  readonly kind: ChargeKind;
  // 0 when no attempt could be made (a payoff without a mandate).
  readonly attempt: number;
  readonly reason: string;
};

// The debtor's bank returned a debit the provider had collected (SEPA Core: up to 8 weeks, 13
// months when unauthorised): the charge is owed again from that day and dunned like a failed one
// (`failed`); lending marks the instalment unpaid.
export type ChargeReturnedPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly kind: ChargeKind;
  readonly installmentNumber: number | null;
  readonly amountCents: number;
  // The attempt whose payment came back.
  readonly attempt: number;
  // The bank's return reason code (ISO 20022, `MD06`, `AC04`...).
  readonly reason: string;
  readonly dueDate: string;
  readonly returnedAt: string;
};

// Dunning notices: the first a day after the due date, the second at fifteen days.
export type ChargeOverduePayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly amountCents: number;
  readonly notice: 1 | 2;
  readonly daysOverdue: number;
};

// A charge 30 days overdue: the contract is in arrears (lending, and the center's webhook).
export type ContractInArrearsPayload = {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly chargeId: string;
  readonly daysOverdue: number;
};

// A payment left nothing of the contract in arrears.
export type ArrearsClearedPayload = {
  readonly contractId: string;
  readonly centerId: string;
};

// Uncollectible: 90 days overdue, the end of dunning, and of the contract (lending defaults it);
// or the principal a defaulted loan had left to bill.
export type ChargeWrittenOffPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly amountCents: number;
  readonly reason: 'dunning_exhausted' | 'contract_defaulted';
};

export type ChargeCancelledPayload = {
  readonly chargeId: string;
  readonly contractId: string;
  readonly amountCents: number;
  // The plan ended before the charge fell due, or the bank refused a payoff.
  readonly reason: 'plan_ended' | 'payoff_failed';
};

export type IncomeDeclaredPayload = {
  readonly declarationId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly period: string;
};

// The 25th: an ISA student has not declared this month's income yet.
export type IncomeDeclarationDuePayload = {
  readonly contractId: string;
  readonly studentId: string;
  readonly period: string;
};
