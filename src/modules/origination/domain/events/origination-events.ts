import { type ApplicationStatus } from '../model/application-status';

// Published contract of the origination module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent.
export const OriginationEvents = {
  ApplicationSubmitted: 'ApplicationSubmitted',
  VerificationCompleted: 'VerificationCompleted',
  ApplicationApproved: 'ApplicationApproved',
  ApplicationNeedsReview: 'ApplicationNeedsReview',
  ApplicationRejected: 'ApplicationRejected',
  OfferAccepted: 'OfferAccepted',
  ApplicationCancelled: 'ApplicationCancelled',
  ApplicationExpired: 'ApplicationExpired',
} as const;

// Starts the verification saga.
export type ApplicationSubmittedPayload = {
  readonly applicationId: string;
  readonly applicantId: string;
  readonly centerId: string;
  readonly programId: string;
  readonly product: 'installments' | 'isa';
  readonly amountCents: number;
};

// One per provider; the third one moves the application to scoring. Results stay in origination:
// they are personal data, and nobody else needs them.
export type VerificationCompletedPayload = {
  readonly applicationId: string;
  readonly verification: 'kyc' | 'employment' | 'bureau';
  // Answers still missing; 0 means the application is ready to be scored.
  readonly remaining: number;
};

export type ApplicationApprovedPayload = {
  readonly applicationId: string;
  readonly applicantId: string;
  readonly centerId: string;
  readonly programId: string;
  readonly policyVersion: number;
  readonly decidedBy: 'engine' | 'ops';
};

export type ApplicationNeedsReviewPayload = {
  readonly applicationId: string;
  readonly centerId: string;
  readonly policyVersion: number;
};

export type ApplicationRejectedPayload = {
  readonly applicationId: string;
  readonly applicantId: string;
  readonly centerId: string;
  // Hard rules broken, 'score_below_threshold' or 'analyst_decision'. The readable reasons and the
  // score are personal financial data: they stay in the decision record.
  readonly reasonCodes: readonly string[];
  readonly decidedBy: 'engine' | 'ops';
};

// Everything lending needs to draw up the contract, as accepted: the terms do not change after
// this, whatever happens to the program in the catalog.
export type OfferAcceptedPayload = {
  readonly applicationId: string;
  readonly applicantId: string;
  readonly centerId: string;
  readonly programId: string;
  readonly programName: string;
  readonly amountCents: number;
  readonly product:
    | {
        readonly kind: 'installments';
        readonly termMonths: number;
        readonly annualRateBasisPoints: number;
      }
    | {
        readonly kind: 'isa';
        readonly incomeShareBasisPoints: number;
        readonly minMonthlyIncomeCents: number;
        readonly maxPayments: number;
        readonly capMultiplierHundredths: number;
        readonly graceMonths: number;
      };
};

export type ApplicationCancelledPayload = {
  readonly applicationId: string;
  readonly centerId: string;
};

export type ApplicationExpiredPayload = {
  readonly applicationId: string;
  readonly centerId: string;
  // The state it was left in: an approved offer nobody accepted, or a draft never submitted.
  readonly expiredFrom: ApplicationStatus;
};
