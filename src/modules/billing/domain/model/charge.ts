import {
  AggregateRoot,
  type CalendarDate,
  InvalidStateTransitionError,
  type Money,
} from '@shared/domain';

import { PaymentMismatchError, UnknownCollectionAttemptError } from '../errors/billing-errors';
import {
  BillingEvents,
  type ChargeKind,
  type ChargeWrittenOffPayload,
} from '../events/billing-events';
import { ARREARS_STEP, dunningStepsDue, STEPS_BEFORE_DUE } from '../services/dunning';

export const CHARGE_STATUSES = [
  'scheduled',
  'pending',
  'paid',
  'failed',
  'overdue',
  'written_off',
  'cancelled',
] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

// Owed and not being collected: what a collection can start on, and what a payoff makes unowed.
export const OPEN_CHARGE_STATUSES: readonly ChargeStatus[] = ['scheduled', 'failed', 'overdue'];

const MAX_REASON_LENGTH = 200;

// One request to the payment provider. Its key is sent with every call for the attempt, so the
// provider never collects it twice, and comes back on its callback.
export interface CollectionAttempt {
  readonly number: number;
  readonly key: string;
  // The mandate it debits, fixed when the attempt starts: a repeated call sends the same request.
  readonly mandateId: string;
  readonly submittedAt: Date;
  readonly paymentId: string | null;
  // `returned`: collected, then the debtor's bank sent the debit back.
  readonly outcome: 'pending' | 'succeeded' | 'failed' | 'returned';
  // Why it failed, or the bank's return reason code.
  readonly failureReason: string | null;
  readonly settledAt: Date | null;
}

export interface ChargeProps {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly kind: ChargeKind;
  // Unique per contract: what the charge is for (`installment:3`, `isa:2026-07`,
  // `payoff:<request>`).
  readonly reference: string;
  readonly installmentNumber: number | null;
  // The month it belongs to, as YYYY-MM: the instalment's, or the ISA month of income.
  readonly period: string;
  readonly amount: Money;
  readonly dueDate: CalendarDate;
  readonly status: ChargeStatus;
  readonly attempts: readonly CollectionAttempt[];
  // How many dunning steps have been applied, in order (DUNNING_STEPS).
  readonly dunningStep: number;
  readonly paidAt: Date | null;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

// An amount a student owes on a due date, and its collection.
//
//   scheduled → pending → paid
//   pending → failed (before or on the due date) | overdue (after it)
//   scheduled | failed → overdue                  (dunning, the day after the due date)
//   failed | overdue → pending                    (dunning's retries, or ops)
//   scheduled | failed | overdue → written_off    (dunning, 90 days after the due date)
//   scheduled → cancelled                         (the plan ended before it fell due)
//   (new) → written_off                           (accelerated: raised and written off at once)
//   failed | overdue → cancelled                  (the plan was paid off)
//
// A payoff is not dunned: refused, it is cancelled (pending → cancelled) and lending withdraws
// it; the plan is billed as before and the student may ask again.
export class Charge extends AggregateRoot {
  private constructor(
    id: string,
    private props: ChargeProps,
  ) {
    super(id);
  }

  static create(input: {
    id: string;
    contractId: string;
    studentId: string;
    centerId: string;
    kind: ChargeKind;
    reference: string;
    installmentNumber: number | null;
    period: string;
    amount: Money;
    dueDate: CalendarDate;
    now: Date;
  }): Charge {
    const charge = new Charge(input.id, {
      contractId: input.contractId,
      studentId: input.studentId,
      centerId: input.centerId,
      kind: input.kind,
      reference: input.reference,
      installmentNumber: input.installmentNumber,
      period: input.period,
      amount: input.amount,
      dueDate: input.dueDate,
      status: 'scheduled',
      attempts: [],
      dunningStep: 0,
      paidAt: null,
      statusChangedAt: input.now,
      createdAt: input.now,
    });
    charge.record({
      eventType: BillingEvents.ChargeCreated,
      aggregateType: 'Charge',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        chargeId: input.id,
        contractId: input.contractId,
        studentId: input.studentId,
        centerId: input.centerId,
        kind: input.kind,
        amountCents: input.amount.cents,
        dueDate: input.dueDate.toString(),
      },
    });
    return charge;
  }

  // A loan defaulted: the principal of the instalments it had not billed is owed at once. Ops and
  // collections pursue it outside billing, so it is written off as it is raised; the statement and
  // the portfolio figures show the loss. Unique per contract (`accelerated`).
  static accelerate(input: {
    id: string;
    contractId: string;
    studentId: string;
    centerId: string;
    amount: Money;
    today: CalendarDate;
    now: Date;
  }): Charge {
    const { today, ...owed } = input;
    const charge = Charge.create({
      ...owed,
      kind: 'accelerated',
      reference: 'accelerated',
      installmentNumber: null,
      period: today.period,
      dueDate: today,
    });
    charge.writeOff('contract_defaulted', input.now, today);
    return charge;
  }

  static reconstitute(id: string, props: ChargeProps): Charge {
    return new Charge(id, props);
  }

  get contractId(): string {
    return this.props.contractId;
  }

  get studentId(): string {
    return this.props.studentId;
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get kind(): ChargeKind {
    return this.props.kind;
  }

  get reference(): string {
    return this.props.reference;
  }

  get installmentNumber(): number | null {
    return this.props.installmentNumber;
  }

  get period(): string {
    return this.props.period;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get dueDate(): CalendarDate {
    return this.props.dueDate;
  }

  get status(): ChargeStatus {
    return this.props.status;
  }

  get attempts(): readonly CollectionAttempt[] {
    return this.props.attempts;
  }

  get dunningStep(): number {
    return this.props.dunningStep;
  }

  get paidAt(): Date | null {
    return this.props.paidAt;
  }

  get statusChangedAt(): Date {
    return this.props.statusChangedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get collectible(): boolean {
    return OPEN_CHARGE_STATUSES.includes(this.props.status);
  }

  // Past the arrears step of dunning, and not paid.
  get inArrears(): boolean {
    return this.props.dunningStep > ARREARS_STEP && !this.isSettled;
  }

  get currentAttempt(): CollectionAttempt | null {
    return this.props.attempts.at(-1) ?? null;
  }

  // Starts a collection attempt under a mandate; ChargeSubmitted has a job ask the provider with
  // its key.
  submitCollection(mandateId: string, now: Date): string {
    if (!this.collectible) {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'pending');
    }
    const number = this.props.attempts.length + 1;
    const key = `${this.id}.${String(number)}`;
    this.props = {
      ...this.props,
      attempts: [
        ...this.props.attempts,
        {
          number,
          key,
          mandateId,
          submittedAt: now,
          paymentId: null,
          outcome: 'pending',
          failureReason: null,
          settledAt: null,
        },
      ],
    };
    this.moveTo('pending', now);
    this.record({
      eventType: BillingEvents.ChargeSubmitted,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: { chargeId: this.id, contractId: this.props.contractId, attemptKey: key },
    });
    return key;
  }

  // Ops collect it again, outside dunning: a new attempt for a failed or overdue charge, the same
  // one asked again for a charge whose request was lost.
  retryCollection(mandateId: string, now: Date): string {
    if (this.props.status === 'pending') {
      return this.resubmit(now);
    }
    if (this.props.status !== 'failed' && this.props.status !== 'overdue') {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'pending');
    }
    return this.submitCollection(mandateId, now);
  }

  // A payoff that cannot be collected (the contract has no mandate) fails at once, as if the bank
  // had refused it: lending withdraws it instead of the contract waiting on it.
  refusePayoff(reason: string, now: Date): void {
    if (this.props.kind !== 'payoff' || this.props.status !== 'scheduled') {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'cancelled');
    }
    this.record({
      eventType: BillingEvents.ChargeFailed,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        kind: this.props.kind,
        attempt: 0,
        reason,
      },
    });
    this.recordCancelled('payoff_failed', now);
  }

  // A pending attempt asked of the provider again (the job was lost): same key, same request.
  resubmit(now: Date): string {
    const attempt = this.currentAttempt;
    if (this.props.status !== 'pending' || !attempt) {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'pending');
    }
    this.record({
      eventType: BillingEvents.ChargeSubmitted,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: { chargeId: this.id, contractId: this.props.contractId, attemptKey: attempt.key },
    });
    return attempt.key;
  }

  // The provider took the request, or its callback names the payment. Idempotent; another
  // payment for the same attempt is refused.
  recordAccepted(key: string, paymentId: string): void {
    const attempt = this.attempt(key);
    if (attempt.paymentId === paymentId) {
      return;
    }
    if (attempt.paymentId) {
      throw new PaymentMismatchError(key);
    }
    this.replaceAttempt({ ...attempt, paymentId });
  }

  // The provider collected it. Idempotent, also once the payment has been returned since. When
  // this charge kept the contract in arrears and no other does, the contract is current again
  // (ArrearsCleared).
  recordSucceeded(key: string, now: Date, otherChargesInArrears: boolean): void {
    const attempt = this.attempt(key);
    if (attempt.outcome === 'succeeded' || attempt.outcome === 'returned') {
      return;
    }
    if (attempt.outcome !== 'pending' || this.props.status !== 'pending') {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'paid');
    }
    const wasInArrears = this.inArrears;
    this.replaceAttempt({ ...attempt, outcome: 'succeeded', settledAt: now });
    this.props = { ...this.props, paidAt: now };
    this.moveTo('paid', now);
    this.record({
      eventType: BillingEvents.ChargePaid,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        kind: this.props.kind,
        installmentNumber: this.props.installmentNumber,
        amountCents: this.props.amount.cents,
        attempt: attempt.number,
        period: this.props.period,
        paidAt: now.toISOString(),
      },
    });
    if (wasInArrears && !otherChargesInArrears) {
      this.record({
        eventType: BillingEvents.ArrearsCleared,
        aggregateType: 'Charge',
        aggregateId: this.id,
        occurredAt: now,
        payload: { contractId: this.props.contractId, centerId: this.props.centerId },
      });
    }
  }

  // The provider could not collect it. Idempotent. Failed on or before the due date, overdue
  // after it; a payoff is cancelled.
  recordFailed(key: string, reason: string, today: CalendarDate, now: Date): void {
    const attempt = this.attempt(key);
    if (attempt.outcome === 'failed') {
      return;
    }
    if (attempt.outcome !== 'pending' || this.props.status !== 'pending') {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'failed');
    }
    const failureReason = reason.trim().slice(0, MAX_REASON_LENGTH) || 'unspecified';
    this.replaceAttempt({ ...attempt, outcome: 'failed', failureReason, settledAt: now });
    if (this.props.kind !== 'payoff') {
      this.moveTo(today.isAfter(this.props.dueDate) ? 'overdue' : 'failed', now);
    }
    this.record({
      eventType: BillingEvents.ChargeFailed,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        kind: this.props.kind,
        attempt: attempt.number,
        reason: failureReason,
      },
    });
    if (this.props.kind === 'payoff') {
      this.recordCancelled('payoff_failed', now);
    }
  }

  // The debtor's bank returned the debit after the provider collected it. Idempotent: the same
  // attempt returned again writes nothing. The charge is owed again and due that day, so dunning
  // starts over from the return, as for a charge billed late, rather than at once catching up
  // with the steps (arrears, write-off) its old due date has long passed. A payoff is not dunned:
  // the plan it paid off stays ended and ops collect it (ADR 020).
  recordReturned(key: string, reason: string, today: CalendarDate, now: Date): void {
    const attempt = this.attempt(key);
    if (attempt.outcome === 'returned') {
      return;
    }
    if (attempt.outcome !== 'succeeded' || this.props.status !== 'paid') {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'failed');
    }
    const returnReason = reason.trim().slice(0, MAX_REASON_LENGTH) || 'unspecified';
    this.replaceAttempt({
      ...attempt,
      outcome: 'returned',
      failureReason: returnReason,
      settledAt: now,
    });
    const dueDate = today.isAfter(this.props.dueDate) ? today : this.props.dueDate;
    this.props = { ...this.props, paidAt: null, dueDate, dunningStep: STEPS_BEFORE_DUE };
    this.moveTo('failed', now);
    this.record({
      eventType: BillingEvents.ChargeReturned,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        kind: this.props.kind,
        installmentNumber: this.props.installmentNumber,
        amountCents: this.props.amount.cents,
        attempt: attempt.number,
        reason: returnReason,
        dueDate: dueDate.toString(),
        returnedAt: now.toISOString(),
        period: this.props.period,
      },
    });
  }

  // Applies the dunning steps due on `asOf` that were not applied yet (see DUNNING_STEPS) and
  // says whether collection is to be tried again. A paid, written off or cancelled charge has
  // nothing to dun; one being collected waits for the provider's answer. A payoff is never
  // dunned: it is collected once, or cancelled.
  //
  // `contractInArrears`: another charge already holds the contract in arrears, or it has
  // defaulted. The arrears step is then applied without announcing the contract in arrears again.
  applyDunning(
    asOf: CalendarDate,
    now: Date,
    contractInArrears = false,
  ): { readonly retry: boolean } {
    if (this.isSettled || this.props.status === 'pending' || this.props.kind === 'payoff') {
      return { retry: false };
    }
    const steps = dunningStepsDue(this.props.dueDate, asOf, this.props.dunningStep);
    const daysOverdue = this.props.dueDate.daysUntil(asOf);
    // A run that catches up with both notices sends the student the later one only.
    const lastNotice = steps
      .filter((step) => step.action === 'first_notice' || step.action === 'second_notice')
      .at(-1);
    let retry = false;
    for (const step of steps) {
      switch (step.action) {
        case 'reminder':
          if (this.props.status === 'scheduled' && daysOverdue <= 0) {
            this.recordDue(now);
          }
          break;
        case 'first_notice':
        case 'second_notice':
          this.moveTo('overdue', now);
          if (step === lastNotice) {
            this.recordOverdue(step.action === 'first_notice' ? 1 : 2, daysOverdue, now);
          }
          break;
        case 'retry':
          retry = true;
          break;
        case 'arrears':
          if (contractInArrears) {
            break;
          }
          this.record({
            eventType: BillingEvents.ContractInArrears,
            aggregateType: 'Charge',
            aggregateId: this.id,
            occurredAt: now,
            payload: {
              contractId: this.props.contractId,
              studentId: this.props.studentId,
              centerId: this.props.centerId,
              chargeId: this.id,
              daysOverdue,
            },
          });
          break;
        case 'write_off':
          this.writeOff('dunning_exhausted', now, asOf);
          retry = false;
          break;
      }
    }
    this.props = { ...this.props, dunningStep: this.props.dunningStep + steps.length };
    return { retry: retry && this.collectible };
  }

  // Whether dunning as of `asOf` reaches the arrears step of this charge, not applied yet: the
  // caller then finds out whether the contract is in arrears already.
  reachesArrears(asOf: CalendarDate): boolean {
    return dunningStepsDue(this.props.dueDate, asOf, this.props.dunningStep).some(
      (step) => step.action === 'arrears',
    );
  }

  // No longer owed: the plan ended before it fell due (paid off, defaulted), or a payoff covered
  // it after it failed. A charge being collected waits for its answer. Idempotent.
  cancel(now: Date): void {
    if (this.props.status === 'cancelled') {
      return;
    }
    if (!this.collectible) {
      throw new InvalidStateTransitionError('Charge', this.props.status, 'cancelled');
    }
    this.recordCancelled('plan_ended', now);
  }

  private recordCancelled(reason: 'plan_ended' | 'payoff_failed', now: Date): void {
    this.moveTo('cancelled', now);
    this.record({
      eventType: BillingEvents.ChargeCancelled,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        amountCents: this.props.amount.cents,
        reason,
      },
    });
  }

  private get isSettled(): boolean {
    return ['paid', 'written_off', 'cancelled'].includes(this.props.status);
  }

  private writeOff(reason: ChargeWrittenOffPayload['reason'], now: Date, day: CalendarDate): void {
    this.moveTo('written_off', now);
    this.record({
      eventType: BillingEvents.ChargeWrittenOff,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        amountCents: this.props.amount.cents,
        reason,
        writtenOffOn: day.toString(),
      },
    });
  }

  private recordDue(now: Date): void {
    this.record({
      eventType: BillingEvents.ChargeDueSoon,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        amountCents: this.props.amount.cents,
        dueDate: this.props.dueDate.toString(),
      },
    });
  }

  private recordOverdue(notice: 1 | 2, daysOverdue: number, now: Date): void {
    this.record({
      eventType: BillingEvents.ChargeOverdue,
      aggregateType: 'Charge',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        chargeId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        amountCents: this.props.amount.cents,
        notice,
        daysOverdue,
      },
    });
  }

  private attempt(key: string): CollectionAttempt {
    const attempt = this.props.attempts.find((candidate) => candidate.key === key);
    if (!attempt) {
      throw new UnknownCollectionAttemptError(key);
    }
    return attempt;
  }

  private replaceAttempt(attempt: CollectionAttempt): void {
    this.props = {
      ...this.props,
      attempts: this.props.attempts.map((candidate) =>
        candidate.number === attempt.number ? attempt : candidate,
      ),
    };
  }

  private moveTo(status: ChargeStatus, now: Date): void {
    if (this.props.status !== status) {
      this.props = { ...this.props, status, statusChangedAt: now };
    }
  }
}
