import { AggregateRoot, type Iban, InvalidStateTransitionError, type Money } from '@shared/domain';

import { LendingEvents } from '../events/lending-events';

export const DISBURSEMENT_STATUSES = ['pending', 'sent', 'settled', 'failed', 'cancelled'] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

const MAX_REASON_LENGTH = 200;

// Who an attempt pays, fixed before the bank is called.
export interface Creditor {
  readonly iban: Iban;
  readonly holderName: string;
}

export interface DisbursementProps {
  readonly contractId: string;
  readonly centerId: string;
  readonly amount: Money;
  // 1 for the first transfer; each retry by ops is a new attempt with its own idempotency key.
  readonly attempt: number;
  // Set before the bank is first called for this attempt: from then on the attempt may have paid,
  // so it is only ever sent again with the same key to the same account, and only the bank's
  // answer can fail it.
  readonly creditor: Creditor | null;
  // The bank's id for the transfer of the current attempt.
  readonly transferId: string | null;
  readonly failureReason: string | null;
  readonly status: DisbursementStatus;
  readonly statusChangedAt: Date;
  readonly settledAt: Date | null;
  readonly createdAt: Date;
}

// The payment of a signed contract's principal, less the platform fee, to the training center.
// One per contract.
//
//   pending → sent → settled
//   pending (transfer not started) | sent → failed → pending   (ops retries, as a new attempt)
//   failed → cancelled                                          (ops give up and cancel the contract)
export class Disbursement extends AggregateRoot {
  private constructor(
    id: string,
    private props: DisbursementProps,
  ) {
    super(id);
  }

  static request(input: {
    id: string;
    contractId: string;
    centerId: string;
    amount: Money;
    now: Date;
  }): Disbursement {
    const disbursement = new Disbursement(input.id, {
      contractId: input.contractId,
      centerId: input.centerId,
      amount: input.amount,
      attempt: 1,
      creditor: null,
      transferId: null,
      failureReason: null,
      status: 'pending',
      statusChangedAt: input.now,
      settledAt: null,
      createdAt: input.now,
    });
    disbursement.record({
      eventType: LendingEvents.DisbursementRequested,
      aggregateType: 'Disbursement',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        disbursementId: input.id,
        contractId: input.contractId,
        centerId: input.centerId,
        amountCents: input.amount.cents,
      },
    });
    return disbursement;
  }

  static reconstitute(id: string, props: DisbursementProps): Disbursement {
    return new Disbursement(id, props);
  }

  get contractId(): string {
    return this.props.contractId;
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get attempt(): number {
    return this.props.attempt;
  }

  get creditor(): Creditor | null {
    return this.props.creditor;
  }

  get transferStarted(): boolean {
    return this.props.creditor !== null;
  }

  get transferId(): string | null {
    return this.props.transferId;
  }

  get failureReason(): string | null {
    return this.props.failureReason;
  }

  get status(): DisbursementStatus {
    return this.props.status;
  }

  get statusChangedAt(): Date {
    return this.props.statusChangedAt;
  }

  get settledAt(): Date | null {
    return this.props.settledAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // Sent to the bank with every call for this attempt: a repeated call never pays twice, and a
  // retry after a failure is a new transfer.
  get idempotencyKey(): string {
    return `${this.id}.${String(this.props.attempt)}`;
  }

  // Recorded (and saved) before the bank is called. Idempotent: a repeated run of the attempt keeps
  // the creditor it started with.
  startTransfer(creditor: Creditor): Creditor {
    this.assertStatus(['pending'], 'pending');
    if (!this.props.creditor) {
      this.props = { ...this.props, creditor };
    }
    return this.props.creditor ?? creditor;
  }

  markSent(transferId: string, now: Date): void {
    this.assertStatus(['pending'], 'sent');
    if (!this.props.creditor) {
      throw new InvalidStateTransitionError('Disbursement', 'not started', 'sent');
    }
    this.props = { ...this.props, transferId };
    this.moveTo('sent', now);
    this.record({
      eventType: LendingEvents.DisbursementSent,
      aggregateType: 'Disbursement',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        disbursementId: this.id,
        contractId: this.props.contractId,
        attempt: this.props.attempt,
      },
    });
  }

  settle(now: Date): void {
    this.assertStatus(['sent'], 'settled');
    this.props = { ...this.props, settledAt: now };
    this.moveTo('settled', now);
    this.record({
      eventType: LendingEvents.DisbursementSettled,
      aggregateType: 'Disbursement',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        disbursementId: this.id,
        contractId: this.props.contractId,
        centerId: this.props.centerId,
        amountCents: this.props.amount.cents,
        settledAt: now.toISOString(),
      },
    });
  }

  // A pending attempt fails only before its transfer started; after that, money may be out and
  // only the bank's answer (on a sent transfer) decides.
  fail(reason: string, now: Date): void {
    this.assertStatus(['pending', 'sent'], 'failed');
    if (this.props.status === 'pending' && this.props.creditor) {
      throw new InvalidStateTransitionError('Disbursement', 'transfer started', 'failed');
    }
    // A bank may report a failure without a reason; the record always says something.
    const failureReason = reason.trim().slice(0, MAX_REASON_LENGTH) || 'unspecified';
    this.props = { ...this.props, failureReason };
    this.moveTo('failed', now);
    this.record({
      eventType: LendingEvents.DisbursementFailed,
      aggregateType: 'Disbursement',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        disbursementId: this.id,
        contractId: this.props.contractId,
        centerId: this.props.centerId,
        reason: failureReason,
        attempt: this.props.attempt,
      },
    });
  }

  retry(now: Date): void {
    this.assertStatus(['failed'], 'pending');
    this.props = {
      ...this.props,
      attempt: this.props.attempt + 1,
      creditor: null,
      transferId: null,
      failureReason: null,
    };
    this.moveTo('pending', now);
    this.record({
      eventType: LendingEvents.DisbursementRetried,
      aggregateType: 'Disbursement',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        disbursementId: this.id,
        contractId: this.props.contractId,
        centerId: this.props.centerId,
        attempt: this.props.attempt,
      },
    });
  }

  // Ops give up on a failed payment: nothing reached the center, and the contract is cancelled
  // with it. Final: a cancelled disbursement is never retried. The failure reason is kept.
  // Idempotent.
  cancel(now: Date): void {
    if (this.props.status === 'cancelled') {
      return;
    }
    this.assertStatus(['failed'], 'cancelled');
    this.moveTo('cancelled', now);
    this.record({
      eventType: LendingEvents.DisbursementCancelled,
      aggregateType: 'Disbursement',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        disbursementId: this.id,
        contractId: this.props.contractId,
        centerId: this.props.centerId,
        attempt: this.props.attempt,
      },
    });
  }

  private assertStatus(expected: readonly DisbursementStatus[], target: DisbursementStatus): void {
    if (!expected.includes(this.props.status)) {
      throw new InvalidStateTransitionError('Disbursement', this.props.status, target);
    }
  }

  private moveTo(status: DisbursementStatus, now: Date): void {
    this.props = { ...this.props, status, statusChangedAt: now };
  }
}
