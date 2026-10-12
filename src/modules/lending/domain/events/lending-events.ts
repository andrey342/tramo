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
  DisbursementRequested: 'DisbursementRequested',
  DisbursementSettled: 'DisbursementSettled',
  DisbursementFailed: 'DisbursementFailed',
  PayoffRequested: 'PayoffRequested',
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

export type ContractCompletedPayload = {
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

export type DisbursementSettledPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly amountCents: number;
};

export type DisbursementFailedPayload = {
  readonly disbursementId: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly reason: string;
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

// Two months in a row without an income declaration: the student is reminded, ops can see it.
export type IsaDeclarationOverduePayload = {
  readonly planId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly missingSince: string;
};

export type PlanCompletedPayload = {
  readonly planId: string;
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly reason: 'repaid' | 'paid_off' | 'cap_reached' | 'max_payments' | 'window_expired';
};
