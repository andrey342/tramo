// Published contract of the lending module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent.
export const LendingEvents = {
  ContractCreated: 'ContractCreated',
  ContractSentForSignature: 'ContractSentForSignature',
  ContractSigned: 'ContractSigned',
  ContractCancelled: 'ContractCancelled',
  ContractActivated: 'ContractActivated',
  ContractCompleted: 'ContractCompleted',
  ContractDefaulted: 'ContractDefaulted',
  DisbursementRequested: 'DisbursementRequested',
  DisbursementSent: 'DisbursementSent',
  DisbursementSettled: 'DisbursementSettled',
  DisbursementFailed: 'DisbursementFailed',
  DisbursementRetried: 'DisbursementRetried',
  DisbursementCancelled: 'DisbursementCancelled',
  PayoffRequested: 'PayoffRequested',
  PayoffWithdrawn: 'PayoffWithdrawn',
  IsaDeclarationOverdue: 'IsaDeclarationOverdue',
  PlanCompleted: 'PlanCompleted',
} as const;

export type ContractCreatedPayload = {
  readonly contractId: string;
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly programId: string;
  readonly product: 'installments' | 'isa';
  readonly principalCents: number;
};

// The student has a document to sign at the e-signature provider.
export type ContractSentForSignaturePayload = {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly envelopeId: string;
};

// Starts the disbursement to the center.
export type ContractSignedPayload = {
  readonly contractId: string;
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly disbursementAmountCents: number;
  readonly signedAt: string;
};

export type ContractCancelledPayload = {
  readonly contractId: string;
  readonly applicationId: string;
  readonly centerId: string;
  readonly reason: string;
};

// The center has been paid: the repayment plan starts.
export type ContractActivatedPayload = {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly product: 'installments' | 'isa';
  readonly principalCents: number;
  readonly activatedOn: string;
};

// Origination closes the application the contract was drawn from.
export type ContractCompletedPayload = {
  readonly contractId: string;
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
};

// Ops take over the debt.
export type ContractDefaultedPayload = {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
};

export type DisbursementRequestedPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly amountCents: number;
};

// The bank accepted the transfer; it settles later.
export type DisbursementSentPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly attempt: number;
};

// The contract is activated on the day of `settledAt`. Optional for the events recorded before
// it was added: their `occurredAt` is the same instant.
export type DisbursementSettledPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly amountCents: number;
  readonly settledAt?: string;
};

export type DisbursementFailedPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly reason: string;
  readonly attempt: number;
};

// Ops sent a failed disbursement again, as a new attempt.
export type DisbursementRetriedPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly attempt: number;
};

// Ops gave up on a failed disbursement: the center is not paid and the contract is cancelled
// (ContractCancelled, `disbursement_failed`).
export type DisbursementCancelledPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly attempt: number;
};

// The student asked to repay everything at once; billing collects the amount.
export type PayoffRequestedPayload = {
  readonly planId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly amountCents: number;
  readonly asOf: string;
};

// The payoff could not be collected: the plan is repaid as before (billing bills it again).
export type PayoffWithdrawnPayload = {
  readonly planId: string;
  readonly contractId: string;
  readonly studentId: string;
};

// Two months in a row without an income declaration: the student is emailed (notifications),
// and staff see `declarationOverdue` on the contract's schedule until a declaration clears it.
export type IsaDeclarationOverduePayload = {
  readonly planId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly missingSince: string;
};

// `defaulted`: the contract defaulted first; the plan is closed so nothing more is billed.
export type PlanCompletedPayload = {
  readonly planId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly reason:
    'repaid' | 'paid_off' | 'cap_reached' | 'max_payments' | 'window_expired' | 'defaulted';
};
