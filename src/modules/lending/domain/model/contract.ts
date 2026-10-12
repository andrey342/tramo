import {
  AggregateRoot,
  CalendarDate,
  InvalidStateTransitionError,
  InvalidValueError,
} from '@shared/domain';

import { SignatureMismatchError } from '../errors/lending-errors';
import { LendingEvents } from '../events/lending-events';

import { type ContractStatus } from './contract-status';
import {
  type ContractTerms,
  disbursementAmount,
  type FinancedProgram,
  validTerms,
} from './contract-terms';

const CLOCK_SKEW_MS = 5 * 60 * 1000;

// Why a contract was cancelled before it took effect.
export type CancellationReason = 'signature_declined' | 'signature_expired';

// The envelope sent to the e-signature provider and, once the student signs, when they did.
export interface Signature {
  readonly provider: string;
  readonly envelopeId: string;
  // The text the student is asked to sign, kept as sent: a later change to how contracts are
  // rendered does not change what this student signed.
  readonly document: string;
  // Its SHA-256.
  readonly documentHash: string;
  readonly sentAt: Date;
  readonly signedAt: Date | null;
}

export interface ContractProps {
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly program: FinancedProgram;
  readonly terms: ContractTerms;
  readonly signature: Signature | null;
  readonly activatedOn: CalendarDate | null;
  readonly cancellationReason: CancellationReason | null;
  readonly status: ContractStatus;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

// The agreement drawn up from an accepted offer. Its terms never change after it is created.
//
//   draft → sent_for_signature → signed → active → completed
//   draft | sent_for_signature → cancelled        (the student declined, or never signed)
//   active → defaulted                            (billing, after dunning runs out)
//
// Signing starts the disbursement to the center; the contract is active once the center is paid.
export class Contract extends AggregateRoot {
  private constructor(
    id: string,
    private props: ContractProps,
  ) {
    super(id);
  }

  static draw(input: {
    id: string;
    applicationId: string;
    studentId: string;
    centerId: string;
    program: FinancedProgram;
    terms: ContractTerms;
    now: Date;
  }): Contract {
    const contract = new Contract(input.id, {
      applicationId: input.applicationId,
      studentId: input.studentId,
      centerId: input.centerId,
      program: input.program,
      terms: validTerms(input.terms),
      signature: null,
      activatedOn: null,
      cancellationReason: null,
      status: 'draft',
      statusChangedAt: input.now,
      createdAt: input.now,
    });
    contract.record({
      eventType: LendingEvents.ContractCreated,
      aggregateType: 'Contract',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        contractId: input.id,
        applicationId: input.applicationId,
        studentId: input.studentId,
        centerId: input.centerId,
        programId: input.program.programId,
        product: input.terms.product.kind,
        principalCents: input.terms.principal.cents,
      },
    });
    return contract;
  }

  static reconstitute(id: string, props: ContractProps): Contract {
    return new Contract(id, props);
  }

  get applicationId(): string {
    return this.props.applicationId;
  }

  get studentId(): string {
    return this.props.studentId;
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get program(): FinancedProgram {
    return this.props.program;
  }

  get terms(): ContractTerms {
    return this.props.terms;
  }

  get signature(): Signature | null {
    return this.props.signature;
  }

  get activatedOn(): CalendarDate | null {
    return this.props.activatedOn;
  }

  get cancellationReason(): CancellationReason | null {
    return this.props.cancellationReason;
  }

  get status(): ContractStatus {
    return this.props.status;
  }

  get statusChangedAt(): Date {
    return this.props.statusChangedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  sentForSignature(
    envelope: { provider: string; envelopeId: string; document: string; documentHash: string },
    now: Date,
  ): void {
    this.assertStatus('draft', 'sent_for_signature');
    this.props = {
      ...this.props,
      signature: { ...envelope, sentAt: now, signedAt: null },
    };
    this.moveTo('sent_for_signature', now);
    this.record({
      eventType: LendingEvents.ContractSentForSignature,
      aggregateType: 'Contract',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        contractId: this.id,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        envelopeId: envelope.envelopeId,
      },
    });
  }

  // Idempotent: the provider may deliver the same callback twice. A signature for another
  // envelope, or over another document, is refused.
  sign(callback: { envelopeId: string; documentHash: string; signedAt: Date }, now: Date): void {
    const { signature } = this.props;
    if (signature?.signedAt && signature.envelopeId === callback.envelopeId) {
      return;
    }
    if (this.props.status !== 'sent_for_signature' || !signature) {
      throw new InvalidStateTransitionError('Contract', this.props.status, 'signed');
    }
    if (signature.envelopeId !== callback.envelopeId) {
      throw new SignatureMismatchError('envelopeId');
    }
    if (signature.documentHash !== callback.documentHash) {
      throw new SignatureMismatchError('documentHash');
    }
    // The signing time comes from the provider: it cannot precede the envelope, nor lie ahead of
    // now beyond the clock skew webhooks tolerate.
    const signedAt = callback.signedAt.getTime();
    if (
      signedAt < signature.sentAt.getTime() - CLOCK_SKEW_MS ||
      signedAt > now.getTime() + CLOCK_SKEW_MS
    ) {
      throw new InvalidValueError(
        'signedAt',
        'The signing time is outside the life of the envelope.',
      );
    }
    this.props = { ...this.props, signature: { ...signature, signedAt: callback.signedAt } };
    this.moveTo('signed', now);
    this.record({
      eventType: LendingEvents.ContractSigned,
      aggregateType: 'Contract',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        contractId: this.id,
        applicationId: this.props.applicationId,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        disbursementAmountCents: disbursementAmount(this.props.terms).cents,
        signedAt: callback.signedAt.toISOString(),
      },
    });
  }

  // Before signing only: a signed contract is undone by paying it off, not by cancelling it.
  // Idempotent for a contract already cancelled.
  cancel(reason: CancellationReason, now: Date): void {
    if (this.props.status === 'cancelled') {
      return;
    }
    if (this.props.status !== 'draft' && this.props.status !== 'sent_for_signature') {
      throw new InvalidStateTransitionError('Contract', this.props.status, 'cancelled');
    }
    this.props = { ...this.props, cancellationReason: reason };
    this.moveTo('cancelled', now);
    this.record({
      eventType: LendingEvents.ContractCancelled,
      aggregateType: 'Contract',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        contractId: this.id,
        applicationId: this.props.applicationId,
        centerId: this.props.centerId,
        reason,
      },
    });
  }

  // The center has been paid. Repayment counts from this day. Idempotent for an active contract
  // (a redelivered DisbursementSettled).
  activate(now: Date): void {
    if (this.props.status === 'active') {
      return;
    }
    this.assertStatus('signed', 'active');
    const activatedOn = CalendarDate.fromInstant(now);
    this.props = { ...this.props, activatedOn };
    this.moveTo('active', now);
    this.record({
      eventType: LendingEvents.ContractActivated,
      aggregateType: 'Contract',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        contractId: this.id,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        product: this.props.terms.product.kind,
        principalCents: this.props.terms.principal.cents,
        activatedOn: activatedOn.toString(),
      },
    });
  }

  // The plan has ended: repaid, paid off, or for an ISA its cap, payments or window reached.
  complete(now: Date): void {
    if (this.props.status === 'completed') {
      return;
    }
    this.assertStatus('active', 'completed');
    this.moveTo('completed', now);
    this.record({
      eventType: LendingEvents.ContractCompleted,
      aggregateType: 'Contract',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        contractId: this.id,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
      },
    });
  }

  private assertStatus(expected: ContractStatus, target: ContractStatus): void {
    if (this.props.status !== expected) {
      throw new InvalidStateTransitionError('Contract', this.props.status, target);
    }
  }

  private moveTo(status: ContractStatus, now: Date): void {
    this.props = { ...this.props, status, statusChangedAt: now };
  }
}
