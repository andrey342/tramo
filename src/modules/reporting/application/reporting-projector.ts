import { Inject, Injectable } from '@nestjs/common';

import {
  type ArrearsClearedPayload,
  BillingEvents,
  type ChargeCancelledPayload,
  type ChargeCreatedPayload,
  type ChargeFailedPayload,
  type ChargeOverduePayload,
  type ChargePaidPayload,
  type ChargeReturnedPayload,
  type ChargeWrittenOffPayload,
  type ContractInArrearsPayload,
} from '@modules/billing/domain/events/billing-events';
import {
  type ContractActivatedPayload,
  type ContractCancelledPayload,
  type ContractCompletedPayload,
  type ContractCreatedPayload,
  type ContractDefaultedPayload,
  type DisbursementCancelledPayload,
  type DisbursementFailedPayload,
  type DisbursementRequestedPayload,
  type DisbursementRetriedPayload,
  type DisbursementSentPayload,
  type DisbursementSettledPayload,
  LendingEvents,
} from '@modules/lending/domain/events/lending-events';
import {
  type ApplicationApprovedPayload,
  type ApplicationCancelledPayload,
  type ApplicationExpiredPayload,
  type ApplicationNeedsReviewPayload,
  type ApplicationRejectedPayload,
  type ApplicationSubmittedPayload,
  type OfferAcceptedPayload,
  OriginationEvents,
} from '@modules/origination/domain/events/origination-events';
import { type IntegrationEvent } from '@shared/application';
import { CalendarDate } from '@shared/domain';

import { REPORTING_STORE, type ReportingStore } from './ports/reporting-ports';

type Project = (store: ReportingStore, event: IntegrationEvent, at: Date) => Promise<void>;

// What each event says about the facts of the read models (each payload as its module publishes
// it). One table, so the live consumers and
// the rebuild apply exactly the same rules.
const PROJECTIONS: Readonly<Record<string, Project>> = {
  [OriginationEvents.ApplicationSubmitted]: (store, event, at) => {
    const p = event.payload as unknown as ApplicationSubmittedPayload;
    return store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      programId: p.programId,
      product: p.product,
      amountCents: p.amountCents,
      status: 'submitted',
    });
  },
  [OriginationEvents.ApplicationApproved]: (store, event, at) => {
    const p = event.payload as unknown as ApplicationApprovedPayload;
    return store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      programId: p.programId,
      status: 'approved',
      decision: 'approved',
    });
  },
  [OriginationEvents.ApplicationNeedsReview]: (store, event, at) => {
    const p = event.payload as unknown as ApplicationNeedsReviewPayload;
    return store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'needs_review',
    });
  },
  [OriginationEvents.ApplicationRejected]: (store, event, at) => {
    const p = event.payload as unknown as ApplicationRejectedPayload;
    return store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'rejected',
      decision: 'rejected',
    });
  },
  // The funnel ends at the accepted offer. What origination records once its contract is
  // cancelled or completed (ApplicationWithdrawn, ApplicationClosed) is not projected: the
  // contract counts already tell it, and the offer was accepted all the same.
  [OriginationEvents.OfferAccepted]: (store, event, at) => {
    const p = event.payload as unknown as OfferAcceptedPayload;
    return store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      programId: p.programId,
      product: p.product.kind,
      amountCents: p.amountCents,
      status: 'offer_accepted',
    });
  },
  [OriginationEvents.ApplicationCancelled]: (store, event, at) => {
    const p = event.payload as unknown as ApplicationCancelledPayload;
    return store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'cancelled',
    });
  },
  // A draft that expired was never in the funnel.
  [OriginationEvents.ApplicationExpired]: async (store, event, at) => {
    const p = event.payload as unknown as ApplicationExpiredPayload;
    if (p.expiredFrom === 'draft') {
      return;
    }
    await store.recordApplication({
      applicationId: p.applicationId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'expired',
    });
  },
  // What the contract is, for the facts of its charges and disbursements; its status starts
  // with activation (or cancellation before it).
  [LendingEvents.ContractCreated]: (store, event, at) => {
    const p = event.payload as unknown as ContractCreatedPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      product: p.product,
      principalCents: p.principalCents,
    });
  },
  [LendingEvents.ContractActivated]: (store, event, at) => {
    const p = event.payload as unknown as ContractActivatedPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      product: p.product,
      principalCents: p.principalCents,
      status: 'active',
    });
  },
  [LendingEvents.ContractCompleted]: (store, event, at) => {
    const p = event.payload as unknown as ContractCompletedPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'completed',
    });
  },
  [LendingEvents.ContractDefaulted]: (store, event, at) => {
    const p = event.payload as unknown as ContractDefaultedPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'defaulted',
    });
  },
  [LendingEvents.ContractCancelled]: (store, event, at) => {
    const p = event.payload as unknown as ContractCancelledPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'cancelled',
    });
  },
  [BillingEvents.ContractInArrears]: (store, event, at) => {
    const p = event.payload as unknown as ContractInArrearsPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'in_arrears',
    });
  },
  [BillingEvents.ArrearsCleared]: (store, event, at) => {
    const p = event.payload as unknown as ArrearsClearedPayload;
    return store.recordContract({
      contractId: p.contractId,
      at,
      eventId: event.eventId,
      centerId: p.centerId,
      status: 'active',
    });
  },
  [LendingEvents.DisbursementRequested]: (store, event, at) => {
    const p = event.payload as unknown as DisbursementRequestedPayload;
    return store.recordDisbursement({
      disbursementId: p.disbursementId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      amountCents: p.amountCents,
      status: 'pending',
    });
  },
  [LendingEvents.DisbursementSent]: (store, event, at) => {
    const p = event.payload as unknown as DisbursementSentPayload;
    return store.recordDisbursement({
      disbursementId: p.disbursementId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      status: 'sent',
    });
  },
  [LendingEvents.DisbursementSettled]: (store, event, at) => {
    const p = event.payload as unknown as DisbursementSettledPayload;
    return store.recordDisbursement({
      disbursementId: p.disbursementId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      amountCents: p.amountCents,
      status: 'settled',
    });
  },
  [LendingEvents.DisbursementFailed]: (store, event, at) => {
    const p = event.payload as unknown as DisbursementFailedPayload;
    return store.recordDisbursement({
      disbursementId: p.disbursementId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      status: 'failed',
    });
  },
  // Failed for good and cancelled with its contract: no longer a transfer to deal with.
  [LendingEvents.DisbursementCancelled]: (store, event, at) => {
    const p = event.payload as unknown as DisbursementCancelledPayload;
    return store.recordDisbursement({
      disbursementId: p.disbursementId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      status: 'cancelled',
    });
  },
  [LendingEvents.DisbursementRetried]: (store, event, at) => {
    const p = event.payload as unknown as DisbursementRetriedPayload;
    return store.recordDisbursement({
      disbursementId: p.disbursementId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      status: 'pending',
    });
  },
  [BillingEvents.ChargeCreated]: (store, event, at) => {
    const p = event.payload as unknown as ChargeCreatedPayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      kind: p.kind,
      amountCents: p.amountCents,
      status: 'scheduled',
    });
  },
  [BillingEvents.ChargePaid]: (store, event, at) => {
    const p = event.payload as unknown as ChargePaidPayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      kind: p.kind,
      amountCents: p.amountCents,
      status: 'paid',
    });
  },
  [BillingEvents.ChargeFailed]: (store, event, at) => {
    const p = event.payload as unknown as ChargeFailedPayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      kind: p.kind,
      status: 'failed',
      failedOn: CalendarDate.fromInstant(at).toString(),
    });
  },
  // The bank sent the payment back: no longer collected, owed again (failed, as billing has it).
  [BillingEvents.ChargeReturned]: (store, event, at) => {
    const p = event.payload as unknown as ChargeReturnedPayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      kind: p.kind,
      amountCents: p.amountCents,
      status: 'failed',
      failedOn: CalendarDate.fromInstant(at).toString(),
      reopens: true,
    });
  },
  [BillingEvents.ChargeOverdue]: (store, event, at) => {
    const p = event.payload as unknown as ChargeOverduePayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      amountCents: p.amountCents,
      status: 'overdue',
    });
  },
  [BillingEvents.ChargeWrittenOff]: (store, event, at) => {
    const p = event.payload as unknown as ChargeWrittenOffPayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      centerId: p.centerId,
      amountCents: p.amountCents,
      status: 'written_off',
    });
  },
  [BillingEvents.ChargeCancelled]: (store, event, at) => {
    const p = event.payload as unknown as ChargeCancelledPayload;
    return store.recordCharge({
      chargeId: p.chargeId,
      at,
      eventId: event.eventId,
      contractId: p.contractId,
      amountCents: p.amountCents,
      status: 'cancelled',
    });
  },
};

// Applies events to the read models: the consumers one by one as they happen, the rebuild the
// whole history in order.
@Injectable()
export class ReportingProjector {
  static readonly EVENTS: readonly string[] = Object.keys(PROJECTIONS);

  constructor(@Inject(REPORTING_STORE) private readonly store: ReportingStore) {}

  async apply(event: IntegrationEvent): Promise<void> {
    const project = PROJECTIONS[event.eventType];
    if (project) {
      await project(this.store, event, new Date(event.occurredAt));
    }
  }
}
