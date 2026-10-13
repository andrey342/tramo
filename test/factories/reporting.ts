import { uuidv7 } from 'uuidv7';

import { BillingEvents } from '../../src/modules/billing/domain/events/billing-events';
import { LendingEvents } from '../../src/modules/lending/domain/events/lending-events';
import { OriginationEvents } from '../../src/modules/origination/domain/events/origination-events';
import { type IntegrationEvent } from '../../src/shared/application';
import { type EventPayload } from '../../src/shared/domain';

export const TODAY = '2026-11-12';
export const NOW = new Date(`${TODAY}T08:00:00Z`);

let tick = 0;

// An event as the outbox delivers it; each one a millisecond after the previous, ids in order.
export function anEvent(eventType: string, payload: EventPayload, at?: Date): IntegrationEvent {
  tick += 1;
  return {
    eventId: uuidv7(),
    eventType,
    aggregateType: 'Any',
    aggregateId: uuidv7(),
    occurredAt: (at ?? new Date(NOW.getTime() - 60_000 + tick)).toISOString(),
    correlationId: null,
    payload,
  };
}

export interface Portfolio {
  readonly centerId: string;
  readonly programId: string;
  readonly events: readonly IntegrationEvent[];
}

// A center with three applications (one accepted, one rejected, one waiting for an analyst), an
// instalment contract paid to the center whose first charge was collected and second failed
// today, and an ISA contract in arrears.
export function aPortfolio(): Portfolio {
  const centerId = uuidv7();
  const programId = uuidv7();
  const [accepted, rejected, reviewed] = [uuidv7(), uuidv7(), uuidv7()];
  const [loan, isa] = [uuidv7(), uuidv7()];
  const disbursementId = uuidv7();
  const [paid, failed] = [uuidv7(), uuidv7()];
  const application = (applicationId: string, amountCents: number) =>
    anEvent(OriginationEvents.ApplicationSubmitted, {
      applicationId,
      applicantId: uuidv7(),
      centerId,
      programId,
      product: 'installments',
      amountCents,
    });
  const events = [
    application(accepted, 7_500_00),
    application(rejected, 4_200_00),
    application(reviewed, 9_900_00),
    anEvent(OriginationEvents.ApplicationApproved, {
      applicationId: accepted,
      applicantId: uuidv7(),
      centerId,
      programId,
      policyVersion: 1,
      decidedBy: 'engine',
    }),
    anEvent(OriginationEvents.ApplicationRejected, {
      applicationId: rejected,
      applicantId: uuidv7(),
      centerId,
      reasonCodes: ['bureau_defaults'],
      decidedBy: 'engine',
    }),
    anEvent(OriginationEvents.ApplicationNeedsReview, {
      applicationId: reviewed,
      centerId,
      policyVersion: 1,
    }),
    anEvent(OriginationEvents.OfferAccepted, {
      applicationId: accepted,
      applicantId: uuidv7(),
      centerId,
      programId,
      programName: 'Bootcamp',
      amountCents: 7_500_00,
      product: { kind: 'installments', termMonths: 24, annualRateBasisPoints: 750 },
    }),
    anEvent(LendingEvents.ContractActivated, {
      contractId: loan,
      studentId: uuidv7(),
      centerId,
      product: 'installments',
      principalCents: 7_500_00,
      activatedOn: TODAY,
    }),
    anEvent(LendingEvents.DisbursementRequested, {
      disbursementId,
      contractId: loan,
      centerId,
      amountCents: 7_125_00,
    }),
    anEvent(LendingEvents.DisbursementSettled, {
      disbursementId,
      contractId: loan,
      centerId,
      amountCents: 7_125_00,
    }),
    anEvent(BillingEvents.ChargeCreated, {
      chargeId: paid,
      contractId: loan,
      studentId: uuidv7(),
      centerId,
      kind: 'installment',
      amountCents: 337_50,
      dueDate: TODAY,
    }),
    anEvent(BillingEvents.ChargePaid, {
      chargeId: paid,
      contractId: loan,
      studentId: uuidv7(),
      centerId,
      kind: 'installment',
      installmentNumber: 1,
      amountCents: 337_50,
      paidAt: NOW.toISOString(),
    }),
    anEvent(BillingEvents.ChargeCreated, {
      chargeId: failed,
      contractId: loan,
      studentId: uuidv7(),
      centerId,
      kind: 'installment',
      amountCents: 337_50,
      dueDate: TODAY,
    }),
    anEvent(
      BillingEvents.ChargeFailed,
      {
        chargeId: failed,
        contractId: loan,
        studentId: uuidv7(),
        kind: 'installment',
        attempt: 1,
        reason: 'smtp',
      },
      NOW,
    ),
    anEvent(LendingEvents.ContractActivated, {
      contractId: isa,
      studentId: uuidv7(),
      centerId,
      product: 'isa',
      principalCents: 9_900_00,
      activatedOn: TODAY,
    }),
    anEvent(BillingEvents.ContractInArrears, {
      contractId: isa,
      studentId: uuidv7(),
      centerId,
      chargeId: uuidv7(),
      daysOverdue: 30,
    }),
  ];
  return { centerId, programId, events };
}
