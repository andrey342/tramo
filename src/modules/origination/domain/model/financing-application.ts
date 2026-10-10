import { AggregateRoot, InvalidStateTransitionError, InvalidValueError } from '@shared/domain';

import { ApplicationIncompleteError } from '../errors/origination-errors';
import { OriginationEvents, type OfferAcceptedPayload } from '../events/origination-events';

import {
  type ApplicantProfile,
  type CompleteProfile,
  missingFields,
  validProfile,
} from './applicant-profile';
import { type DecisionRecord, type ManualDecision } from './decision-record';
import {
  assertProductOffered,
  type ProgramSnapshot,
  type RequestedProduct,
} from './program-snapshot';
import { NO_VERIFICATIONS, type VerificationResult, type Verifications } from './verification';

export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'verifying',
  'scoring',
  'approved',
  'needs_review',
  'rejected',
  'offer_accepted',
  'cancelled',
  'expired',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const TERMINAL: readonly ApplicationStatus[] = [
  'rejected',
  'offer_accepted',
  'cancelled',
  'expired',
];

// An application that has not moved for this long expires (a draft never submitted, an offer
// never accepted, a verification stuck behind a provider outage).
export const EXPIRY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REASON_LENGTH = 500;

// Who started it: the student, or their training center on their behalf (API key).
export type ApplicationOrigin = 'student' | 'center';

export interface FinancingApplicationProps {
  readonly applicantId: string;
  readonly origin: ApplicationOrigin;
  readonly program: ProgramSnapshot;
  readonly product: RequestedProduct;
  readonly profile: ApplicantProfile;
  readonly verifications: Verifications;
  readonly decision: DecisionRecord | null;
  readonly manualDecision: ManualDecision | null;
  readonly status: ApplicationStatus;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

// A student's request to finance one program.
//
//   draft → submitted → verifying → scoring → approved | needs_review | rejected
//   needs_review → approved | rejected            (ops, with a reason)
//   approved → offer_accepted                     (lending takes over)
//   any state not final → cancelled (student) | expired (EXPIRY_DAYS without moving)
//
// Verification results arrive in any order; the third one moves it to scoring.
export class FinancingApplication extends AggregateRoot {
  private constructor(
    id: string,
    private props: FinancingApplicationProps,
  ) {
    super(id);
  }

  static start(input: {
    id: string;
    applicantId: string;
    origin: ApplicationOrigin;
    program: ProgramSnapshot;
    product: RequestedProduct;
    profile: ApplicantProfile;
    now: Date;
  }): FinancingApplication {
    assertProductOffered(input.program, input.product);
    return new FinancingApplication(input.id, {
      applicantId: input.applicantId,
      origin: input.origin,
      program: input.program,
      product: input.product,
      profile: validProfile(input.profile, input.now),
      verifications: NO_VERIFICATIONS,
      decision: null,
      manualDecision: null,
      status: 'draft',
      statusChangedAt: input.now,
      createdAt: input.now,
    });
  }

  static reconstitute(id: string, props: FinancingApplicationProps): FinancingApplication {
    return new FinancingApplication(id, props);
  }

  get applicantId(): string {
    return this.props.applicantId;
  }

  get centerId(): string {
    return this.props.program.centerId;
  }

  get origin(): ApplicationOrigin {
    return this.props.origin;
  }

  get program(): ProgramSnapshot {
    return this.props.program;
  }

  get product(): RequestedProduct {
    return this.props.product;
  }

  get profile(): ApplicantProfile {
    return this.props.profile;
  }

  get verifications(): Verifications {
    return this.props.verifications;
  }

  get decision(): DecisionRecord | null {
    return this.props.decision;
  }

  get manualDecision(): ManualDecision | null {
    return this.props.manualDecision;
  }

  get status(): ApplicationStatus {
    return this.props.status;
  }

  get statusChangedAt(): Date {
    return this.props.statusChangedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get isFinal(): boolean {
    return TERMINAL.includes(this.props.status);
  }

  // Provider answers are still wanted (late or repeated answers are ignored by the caller).
  get awaitsVerification(): boolean {
    return this.props.status === 'submitted' || this.props.status === 'verifying';
  }

  // The complete profile, once submitted; scoring and providers only run on submitted ones.
  get submittedProfile(): CompleteProfile {
    const missing = missingFields(this.props.profile);
    if (missing.length > 0) {
      throw new ApplicationIncompleteError(missing);
    }
    return this.props.profile as CompleteProfile;
  }

  // The student completes a draft little by little; a new program or product is checked
  // against what that program offers.
  updateDraft(
    changes: {
      readonly program?: ProgramSnapshot;
      readonly product?: RequestedProduct;
      readonly profile?: Partial<ApplicantProfile>;
    },
    now: Date,
  ): void {
    this.assertStatus('draft', 'draft');
    const program = changes.program ?? this.props.program;
    const product = changes.product ?? this.props.product;
    assertProductOffered(program, product);
    this.props = {
      ...this.props,
      program,
      product,
      profile: validProfile({ ...this.props.profile, ...changes.profile }, now),
    };
  }

  // `program` is the catalog's current version: the student applies for what is offered now.
  submit(program: ProgramSnapshot, now: Date): void {
    this.assertStatus('draft', 'submitted');
    assertProductOffered(program, this.props.product);
    const missing = missingFields(this.props.profile);
    if (missing.length > 0) {
      throw new ApplicationIncompleteError(missing);
    }
    this.props = { ...this.props, program };
    this.moveTo('submitted', now);
    this.record({
      eventType: OriginationEvents.ApplicationSubmitted,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        applicationId: this.id,
        applicantId: this.props.applicantId,
        centerId: this.centerId,
        programId: program.programId,
        product: this.props.product.kind,
        amountCents: program.price.cents,
      },
    });
  }

  startVerification(now: Date): void {
    this.assertStatus('submitted', 'verifying');
    this.moveTo('verifying', now);
  }

  // Idempotent per provider: an answer already recorded is kept. The third answer moves the
  // application to scoring.
  recordVerification(verification: VerificationResult, now: Date): void {
    if (!this.awaitsVerification) {
      throw new InvalidStateTransitionError('FinancingApplication', this.props.status, 'verifying');
    }
    if (this.props.verifications[verification.type] !== null) {
      return;
    }
    const checked = { ...verification.result, checkedAt: now };
    this.props = {
      ...this.props,
      verifications: { ...this.props.verifications, [verification.type]: checked },
    };
    if (this.props.status === 'submitted') {
      this.moveTo('verifying', now);
    }
    this.record({
      eventType: OriginationEvents.VerificationCompleted,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: { applicationId: this.id, verification: verification.type },
    });
    const { kyc, employment, bureau } = this.props.verifications;
    if (kyc && employment && bureau) {
      this.moveTo('scoring', now);
    }
  }

  // The engine's verdict.
  decide(decision: DecisionRecord, now: Date): void {
    this.assertStatus('scoring', decision.outcome);
    this.props = { ...this.props, decision };
    this.moveTo(decision.outcome, now);
    switch (decision.outcome) {
      case 'approved':
        this.recordApproved('engine', now);
        break;
      case 'rejected':
        this.recordRejected(decision.reasons, 'engine', now);
        break;
      case 'needs_review':
        this.record({
          eventType: OriginationEvents.ApplicationNeedsReview,
          aggregateType: 'FinancingApplication',
          aggregateId: this.id,
          occurredAt: now,
          payload: {
            applicationId: this.id,
            centerId: this.centerId,
            score: decision.score,
            policyVersion: decision.policyVersion,
          },
        });
        break;
    }
  }

  // An ops analyst settles an application the engine could not.
  decideManually(
    input: { outcome: 'approved' | 'rejected'; reason: string; decidedBy: string },
    now: Date,
  ): void {
    this.assertStatus('needs_review', input.outcome);
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
      throw new InvalidValueError(
        'reason',
        `A manual decision needs a reason of 1 to ${String(MAX_REASON_LENGTH)} characters.`,
      );
    }
    this.props = {
      ...this.props,
      manualDecision: {
        outcome: input.outcome,
        reason,
        decidedBy: input.decidedBy,
        decidedAt: now,
      },
    };
    this.moveTo(input.outcome, now);
    if (input.outcome === 'approved') {
      this.recordApproved('ops', now);
    } else {
      this.recordRejected([reason], 'ops', now);
    }
  }

  acceptOffer(now: Date): void {
    this.assertStatus('approved', 'offer_accepted');
    this.moveTo('offer_accepted', now);
    const { program, product } = this.props;
    let terms: OfferAcceptedPayload['product'];
    if (product.kind === 'installments' && program.installments) {
      terms = {
        kind: 'installments',
        termMonths: product.termMonths,
        annualRateBasisPoints: program.installments.annualRate.basisPoints,
      };
    } else if (product.kind === 'isa' && program.isa) {
      terms = {
        kind: 'isa',
        incomeShareBasisPoints: program.isa.incomeShare.basisPoints,
        minMonthlyIncomeCents: program.isa.minMonthlyIncome.cents,
        maxPayments: program.isa.maxPayments,
        capMultiplierHundredths: program.isa.capMultiplierHundredths,
        graceMonths: program.isa.graceMonths,
      };
    } else {
      // Checked on start, update and submit; a snapshot without the product is corrupt.
      throw new Error(`Application ${this.id} has no terms for ${product.kind}.`);
    }
    this.record({
      eventType: OriginationEvents.OfferAccepted,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        applicationId: this.id,
        applicantId: this.props.applicantId,
        centerId: this.centerId,
        programId: program.programId,
        programName: program.name,
        amountCents: program.price.cents,
        product: terms,
      },
    });
  }

  cancel(now: Date): void {
    if (this.isFinal) {
      throw new InvalidStateTransitionError('FinancingApplication', this.props.status, 'cancelled');
    }
    this.moveTo('cancelled', now);
    this.record({
      eventType: OriginationEvents.ApplicationCancelled,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: { applicationId: this.id, centerId: this.centerId },
    });
  }

  isStale(now: Date): boolean {
    return (
      !this.isFinal && now.getTime() - this.props.statusChangedAt.getTime() >= EXPIRY_DAYS * DAY_MS
    );
  }

  expire(now: Date): void {
    if (!this.isStale(now)) {
      throw new InvalidStateTransitionError('FinancingApplication', this.props.status, 'expired');
    }
    const expiredFrom = this.props.status;
    this.moveTo('expired', now);
    this.record({
      eventType: OriginationEvents.ApplicationExpired,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: { applicationId: this.id, centerId: this.centerId, expiredFrom },
    });
  }

  private recordApproved(decidedBy: 'engine' | 'ops', now: Date): void {
    this.record({
      eventType: OriginationEvents.ApplicationApproved,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        applicationId: this.id,
        applicantId: this.props.applicantId,
        centerId: this.centerId,
        programId: this.props.program.programId,
        score: this.props.decision?.score ?? 0,
        policyVersion: this.props.decision?.policyVersion ?? 0,
        decidedBy,
      },
    });
  }

  private recordRejected(reasons: readonly string[], decidedBy: 'engine' | 'ops', now: Date): void {
    this.record({
      eventType: OriginationEvents.ApplicationRejected,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        applicationId: this.id,
        applicantId: this.props.applicantId,
        centerId: this.centerId,
        reasons,
        decidedBy,
      },
    });
  }

  private assertStatus(expected: ApplicationStatus, to: string): void {
    if (this.props.status !== expected) {
      throw new InvalidStateTransitionError('FinancingApplication', this.props.status, to);
    }
  }

  private moveTo(status: ApplicationStatus, now: Date): void {
    this.props = { ...this.props, status, statusChangedAt: now };
  }
}
