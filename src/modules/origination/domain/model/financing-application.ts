import { AggregateRoot, InvalidStateTransitionError, InvalidValueError } from '@shared/domain';

import { ApplicationIncompleteError } from '../errors/origination-errors';
import { OriginationEvents, type OfferAcceptedPayload } from '../events/origination-events';

import {
  type ApplicantProfile,
  type CompleteProfile,
  missingFields,
  validProfile,
} from './applicant-profile';
import { type ApplicationStatus } from './application-status';
import { type DecisionRecord, type HardRule, type ManualDecision } from './decision-record';
import {
  assertProductOffered,
  type ProgramSnapshot,
  type RequestedProduct,
} from './program-snapshot';
import { NO_VERIFICATIONS, type VerificationResult, type Verifications } from './verification';

// Why an application was rejected, as codes: readable reasons stay in the decision record.
type RejectionCode = HardRule | 'score_below_threshold' | 'analyst_decision';

const TERMINAL: readonly ApplicationStatus[] = [
  'rejected',
  'offer_accepted',
  'cancelled',
  'expired',
];

// An application nobody has touched for this long expires: a draft abandoned, an offer never
// accepted, a verification stuck behind a provider outage. One waiting for an analyst does not:
// the review queue is ops' backlog, not the student's.
export const EXPIRY_DAYS = 14;
const NEVER_EXPIRE: readonly ApplicationStatus[] = ['needs_review'];
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
  // Last change of status or edit of the draft; expiry counts from here.
  readonly lastActivityAt: Date;
  readonly createdAt: Date;
}

// A student's request to finance one program.
//
//   draft → submitted → verifying → scoring → approved | needs_review | rejected
//   needs_review → approved | rejected            (ops, with a reason)
//   approved → offer_accepted                     (lending takes over)
//   any state not final → cancelled (student) | expired (EXPIRY_DAYS without moving)
//
// Verification results arrive in any order: the first moves it to verifying, the third to scoring.
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
      lastActivityAt: input.now,
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

  get lastActivityAt(): Date {
    return this.props.lastActivityAt;
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
    // Moved to another center's program, the draft is the student's alone: the center that
    // started it has no say over an application for another center.
    const origin = program.centerId === this.centerId ? this.props.origin : 'student';
    this.props = {
      ...this.props,
      program,
      product,
      origin,
      profile: validProfile({ ...this.props.profile, ...changes.profile }, now),
      lastActivityAt: now,
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
    const { kyc, employment, bureau } = this.props.verifications;
    const remaining = [kyc, employment, bureau].filter((answer) => answer === null).length;
    this.record({
      eventType: OriginationEvents.VerificationCompleted,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: { applicationId: this.id, verification: verification.type, remaining },
    });
    if (remaining === 0) {
      this.moveTo('scoring', now);
    }
  }

  // The engine's verdict.
  decide(decision: DecisionRecord, now: Date): void {
    this.assertStatus('scoring', decision.outcome);
    if (decision.score < 0 || decision.score > 100) {
      throw new InvalidValueError('score', 'A score is between 0 and 100.');
    }
    if (decision.outcome !== 'rejected' && decision.hardRulesBroken.length > 0) {
      throw new InvalidValueError(
        'decision',
        'An application that breaks a hard rule can only be rejected.',
      );
    }
    this.props = { ...this.props, decision };
    this.moveTo(decision.outcome, now);
    switch (decision.outcome) {
      case 'approved':
        this.recordApproved('engine', now);
        break;
      case 'rejected':
        this.recordRejected(
          decision.hardRulesBroken.length > 0
            ? decision.hardRulesBroken
            : ['score_below_threshold'],
          'engine',
          now,
        );
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
      this.recordRejected(['analyst_decision'], 'ops', now);
    }
  }

  acceptOffer(now: Date): void {
    this.assertStatus('approved', 'offer_accepted');
    // Past its expiry the offer is gone, even if the sweep has not marked it yet.
    if (this.isStale(now)) {
      throw new InvalidStateTransitionError('FinancingApplication', 'expired', 'offer_accepted');
    }
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
      !this.isFinal &&
      !NEVER_EXPIRE.includes(this.props.status) &&
      now.getTime() - this.props.lastActivityAt.getTime() >= EXPIRY_DAYS * DAY_MS
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
    const { decision } = this.props;
    if (!decision) {
      // Approvals come from scoring or from a review of a scored application.
      throw new Error(`Application ${this.id} is approved without a decision record.`);
    }
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
        policyVersion: decision.policyVersion,
        decidedBy,
      },
    });
  }

  private recordRejected(
    reasonCodes: readonly RejectionCode[],
    decidedBy: 'engine' | 'ops',
    now: Date,
  ): void {
    this.record({
      eventType: OriginationEvents.ApplicationRejected,
      aggregateType: 'FinancingApplication',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        applicationId: this.id,
        applicantId: this.props.applicantId,
        centerId: this.centerId,
        reasonCodes,
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
    this.props = { ...this.props, status, statusChangedAt: now, lastActivityAt: now };
  }
}
