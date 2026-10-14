import { InvalidStateTransitionError } from '@shared/domain';

import { aCharge, day, LATER, NOW } from '../../../../../test/factories/billing';
import { PaymentMismatchError, UnknownCollectionAttemptError } from '../errors/billing-errors';
import { BillingEvents } from '../events/billing-events';

import { Charge } from './charge';

const MANDATE_ID = '0199a000-0000-7000-8000-00000000000m';
const eventTypes = (charge: Charge): string[] =>
  charge.pullEvents().map((event) => event.eventType);
const fresh = (overrides: Parameters<typeof aCharge>[0] = {}): Charge => {
  const charge = aCharge(overrides);
  charge.pullEvents();
  return charge;
};

describe('Charge', () => {
  it('should be created scheduled and announced', () => {
    const charge = aCharge({ amountCents: 337_50 });

    expect(charge).toMatchObject({ status: 'scheduled', attempts: [], dunningStep: 0 });
    expect(charge.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: BillingEvents.ChargeCreated,
        payload: expect.objectContaining({ amountCents: 337_50, dueDate: '2026-11-12' }),
      }),
    ]);
  });

  it('should be reconstituted as saved, without events', () => {
    const charge = fresh();

    const loaded = Charge.reconstitute(charge.id, {
      contractId: charge.contractId,
      studentId: charge.studentId,
      centerId: charge.centerId,
      kind: charge.kind,
      reference: charge.reference,
      installmentNumber: charge.installmentNumber,
      period: charge.period,
      amount: charge.amount,
      dueDate: charge.dueDate,
      status: charge.status,
      attempts: charge.attempts,
      dunningStep: charge.dunningStep,
      paidAt: charge.paidAt,
      statusChangedAt: charge.statusChangedAt,
      createdAt: charge.createdAt,
    });

    expect(loaded).toMatchObject({ statusChangedAt: NOW, createdAt: NOW, period: '2026-11' });
    expect(loaded.hasPendingEvents).toBe(false);
  });

  it('should raise the principal a defaulted loan had left to bill, written off', () => {
    const charge = Charge.accelerate({
      id: '0199a000-0000-7000-8000-00000000000a',
      contractId: '0199a000-0000-7000-8000-00000000000c',
      studentId: '0199a000-0000-7000-8000-00000000000s',
      centerId: '0199a000-0000-7000-8000-0000000000ce',
      amount: aCharge({ amountCents: 1_250_65 }).amount,
      today: day('2027-02-11'),
      now: LATER,
    });

    expect(charge).toMatchObject({
      kind: 'accelerated',
      reference: 'accelerated',
      installmentNumber: null,
      period: '2027-02',
      status: 'written_off',
      collectible: false,
    });
    expect(charge.pullEvents()).toEqual([
      expect.objectContaining({ eventType: BillingEvents.ChargeCreated }),
      expect.objectContaining({
        eventType: BillingEvents.ChargeWrittenOff,
        payload: expect.objectContaining({ amountCents: 1_250_65, reason: 'contract_defaulted' }),
      }),
    ]);
    expect(charge.applyDunning(day('2027-06-01'), LATER)).toEqual({ retry: false });
  });

  describe('collection', () => {
    it('should ask the provider again for the attempt in collection, with the same key', () => {
      const charge = fresh();
      const key = charge.submitCollection(MANDATE_ID, NOW);
      charge.pullEvents();

      expect(charge.resubmit(LATER)).toBe(key);
      expect(charge.attempts).toHaveLength(1);
      expect(charge.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: BillingEvents.ChargeSubmitted,
          payload: expect.objectContaining({ attemptKey: key }),
        }),
      ]);
      expect(() => fresh().resubmit(LATER)).toThrow(InvalidStateTransitionError);
    });

    it('should refuse at once a payoff that cannot be collected', () => {
      const charge = fresh({ kind: 'payoff', reference: 'payoff:3' });

      charge.refusePayoff('no_mandate', NOW);

      expect(charge.status).toBe('cancelled');
      expect(eventTypes(charge)).toEqual([
        BillingEvents.ChargeFailed,
        BillingEvents.ChargeCancelled,
      ]);
      expect(() => {
        fresh().refusePayoff('no_mandate', NOW);
      }).toThrow(InvalidStateTransitionError);
    });

    it('should cancel a payoff the provider refused, and never dun it', () => {
      const charge = fresh({ kind: 'payoff', reference: 'payoff:1' });

      charge.recordFailed(
        charge.submitCollection(MANDATE_ID, NOW),
        'insufficient_funds',
        day('2026-11-20'),
        NOW,
      );

      expect(charge.status).toBe('cancelled');
      expect(charge.pullEvents()).toEqual([
        expect.objectContaining({ eventType: BillingEvents.ChargeSubmitted }),
        expect.objectContaining({
          eventType: BillingEvents.ChargeFailed,
          payload: expect.objectContaining({ kind: 'payoff' }),
        }),
        expect.objectContaining({
          eventType: BillingEvents.ChargeCancelled,
          payload: expect.objectContaining({ reason: 'payoff_failed' }),
        }),
      ]);
      const unpaid = fresh({ kind: 'payoff', reference: 'payoff:2' });
      expect(unpaid.applyDunning(day('2027-03-01'), NOW)).toEqual({ retry: false });
      expect(unpaid).toMatchObject({ status: 'scheduled', dunningStep: 0 });
    });

    it('should be paid through an attempt whose key the provider echoes, once', () => {
      const charge = fresh();

      const key = charge.submitCollection(MANDATE_ID, NOW);
      charge.recordAccepted(key, 'pay-1');
      charge.recordAccepted(key, 'pay-1');
      expect(() => {
        charge.recordAccepted(key, 'pay-2');
      }).toThrow(PaymentMismatchError);
      charge.recordSucceeded(key, LATER, false);
      charge.recordSucceeded(key, LATER, false);

      expect(key).toBe(`${charge.id}.1`);
      expect(charge).toMatchObject({ status: 'paid', paidAt: LATER });
      expect(charge.currentAttempt).toMatchObject({ paymentId: 'pay-1', outcome: 'succeeded' });
      expect(eventTypes(charge)).toEqual([BillingEvents.ChargeSubmitted, BillingEvents.ChargePaid]);
    });

    it('should fail on or before the due date and be overdue after it', () => {
      const onTime = fresh();
      const late = fresh();

      onTime.recordFailed(
        onTime.submitCollection(MANDATE_ID, NOW),
        'insufficient_funds',
        day('2026-11-12'),
        NOW,
      );
      late.recordFailed(late.submitCollection(MANDATE_ID, NOW), '', day('2026-11-15'), NOW);

      expect(onTime.status).toBe('failed');
      expect(late.status).toBe('overdue');
      expect(late.currentAttempt?.failureReason).toBe('unspecified');
      expect(eventTypes(onTime)).toEqual([
        BillingEvents.ChargeSubmitted,
        BillingEvents.ChargeFailed,
      ]);
    });

    it('should try again with a new key after a failure', () => {
      const charge = fresh();
      charge.recordFailed(
        charge.submitCollection(MANDATE_ID, NOW),
        'insufficient_funds',
        day('2026-11-12'),
        NOW,
      );

      const second = charge.submitCollection(MANDATE_ID, LATER);

      expect(second).toBe(`${charge.id}.2`);
      expect(charge.status).toBe('pending');
      expect(charge.attempts).toHaveLength(2);
    });

    it('should refuse callbacks that do not fit', () => {
      const charge = fresh();
      const key = charge.submitCollection(MANDATE_ID, NOW);

      expect(() => {
        charge.recordSucceeded(`${charge.id}.9`, NOW, false);
      }).toThrow(UnknownCollectionAttemptError);
      charge.recordSucceeded(key, NOW, false);
      expect(() => {
        charge.recordFailed(key, 'late', day('2026-11-12'), NOW);
      }).toThrow(InvalidStateTransitionError);
      const refused = fresh();
      const first = refused.submitCollection(MANDATE_ID, NOW);
      refused.recordFailed(first, 'insufficient_funds', day('2026-11-12'), NOW);
      refused.recordFailed(first, 'insufficient_funds', day('2026-11-12'), NOW);
      expect(() => {
        refused.recordSucceeded(first, NOW, false);
      }).toThrow(InvalidStateTransitionError);
      expect(() => charge.submitCollection(MANDATE_ID, NOW)).toThrow(InvalidStateTransitionError);
    });

    it('should be cancelled only before collection starts', () => {
      const charge = fresh();

      charge.cancel(NOW);
      charge.cancel(NOW);

      expect(charge.status).toBe('cancelled');
      expect(eventTypes(charge)).toEqual([BillingEvents.ChargeCancelled]);
      const collecting = fresh();
      collecting.submitCollection(MANDATE_ID, NOW);
      expect(() => {
        collecting.cancel(NOW);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  // Due 12 November 2026, collected that day.
  describe('returns', () => {
    const RETURNED_AT = new Date('2026-12-20T09:00:00Z');
    const collected = (): { charge: Charge; key: string } => {
      const charge = fresh();
      const key = charge.submitCollection(MANDATE_ID, NOW);
      charge.recordAccepted(key, 'pay-1');
      charge.recordSucceeded(key, NOW, false);
      charge.pullEvents();
      return { charge, key };
    };

    it('should owe the charge again when the bank returns its payment', () => {
      const { charge, key } = collected();

      charge.recordReturned(key, 'MD06', day('2026-12-20'), RETURNED_AT);
      charge.recordReturned(key, 'MD06', day('2026-12-21'), LATER);

      expect(charge).toMatchObject({ status: 'failed', paidAt: null, collectible: true });
      expect(charge.dueDate.toString()).toBe('2026-12-20');
      expect(charge.currentAttempt).toMatchObject({
        outcome: 'returned',
        failureReason: 'MD06',
        paymentId: 'pay-1',
      });
      expect(charge.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: BillingEvents.ChargeReturned,
          payload: expect.objectContaining({
            installmentNumber: 1,
            amountCents: 337_50,
            attempt: 1,
            reason: 'MD06',
            dueDate: '2026-12-20',
          }),
        }),
      ]);
    });

    // Returned 38 days after the old due date: dunning starts over from the return instead of
    // putting the contract in arrears the next morning.
    it('should dun a returned charge from the day of the return when the old due date has passed', () => {
      const { charge, key } = collected();
      charge.recordReturned(key, 'AM04', day('2026-12-20'), RETURNED_AT);
      charge.pullEvents();

      expect(charge.applyDunning(day('2026-12-20'), LATER)).toEqual({ retry: false });
      expect(charge.hasPendingEvents).toBe(false);
      charge.applyDunning(day('2026-12-21'), LATER);
      expect(eventTypes(charge)).toEqual([BillingEvents.ChargeOverdue]);
      expect(charge.applyDunning(day('2026-12-23'), LATER)).toEqual({ retry: true });
      expect(charge.inArrears).toBe(false);
    });

    it('should ignore late answers to the first attempt when a returned charge is collected again', () => {
      const { charge, key } = collected();
      charge.recordReturned(key, 'MD06', day('2026-12-20'), RETURNED_AT);

      const second = charge.submitCollection(MANDATE_ID, LATER);
      charge.recordSucceeded(key, LATER, false);
      expect(() => {
        charge.recordFailed(key, 'late', day('2026-12-20'), LATER);
      }).toThrow(InvalidStateTransitionError);
      expect(charge.status).toBe('pending');
      charge.recordSucceeded(second, LATER, false);

      expect(second).toBe(`${charge.id}.2`);
      expect(charge).toMatchObject({ status: 'paid', paidAt: LATER });
      expect(charge.attempts.map((attempt) => attempt.outcome)).toEqual(['returned', 'succeeded']);
    });

    it('should refuse a return when the attempt was not collected', () => {
      const charge = fresh();
      const key = charge.submitCollection(MANDATE_ID, NOW);

      expect(() => {
        charge.recordReturned(key, 'MD06', day('2026-11-20'), NOW);
      }).toThrow(InvalidStateTransitionError);
      charge.recordFailed(key, 'insufficient_funds', day('2026-11-12'), NOW);
      expect(() => {
        charge.recordReturned(key, 'MD06', day('2026-11-20'), NOW);
      }).toThrow(InvalidStateTransitionError);
      expect(() => {
        charge.recordReturned(`${charge.id}.9`, 'MD06', day('2026-11-20'), NOW);
      }).toThrow(UnknownCollectionAttemptError);
    });

    // The plan it paid off stays ended (ADR 020): ops collect it again, dunning does not.
    it('should leave a payoff to ops, never dunned, when its payment is returned', () => {
      const payoff = fresh({ kind: 'payoff', reference: 'payoff:1' });
      const key = payoff.submitCollection(MANDATE_ID, NOW);
      payoff.recordSucceeded(key, NOW, false);

      payoff.recordReturned(key, 'MD01', day('2026-12-20'), RETURNED_AT);

      expect(payoff.status).toBe('failed');
      expect(payoff.applyDunning(day('2027-06-01'), LATER)).toEqual({ retry: false });
      expect(payoff.retryCollection(MANDATE_ID, LATER)).toBe(`${payoff.id}.2`);
    });
  });

  // Due 12 November 2026.
  describe('dunning', () => {
    const dun = (charge: Charge, asOf: string) => {
      const { retry } = charge.applyDunning(day(asOf), NOW);
      return { retry, events: eventTypes(charge), status: charge.status };
    };

    it('should follow the timeline one step at a time', () => {
      const charge = fresh();

      expect(dun(charge, '2026-11-08')).toEqual({ retry: false, events: [], status: 'scheduled' });
      expect(dun(charge, '2026-11-09')).toEqual({
        retry: false,
        events: [BillingEvents.ChargeDueSoon],
        status: 'scheduled',
      });
      expect(dun(charge, '2026-11-13')).toEqual({
        retry: false,
        events: [BillingEvents.ChargeOverdue],
        status: 'overdue',
      });
      expect(dun(charge, '2026-11-15').retry).toBe(true);
      expect(dun(charge, '2026-11-16')).toEqual({ retry: false, events: [], status: 'overdue' });
      expect(dun(charge, '2026-11-19').retry).toBe(true);
      expect(dun(charge, '2026-11-27').events).toEqual([BillingEvents.ChargeOverdue]);
      expect(dun(charge, '2026-12-12').events).toEqual([BillingEvents.ContractInArrears]);
      expect(charge.inArrears).toBe(true);
      expect(dun(charge, '2027-02-10')).toEqual({
        retry: false,
        events: [BillingEvents.ChargeWrittenOff],
        status: 'written_off',
      });
      expect(dun(charge, '2027-06-01')).toEqual({
        retry: false,
        events: [],
        status: 'written_off',
      });
    });

    it('should catch up with every step a late run passed, retrying once', () => {
      const charge = fresh();

      const run = dun(charge, '2026-12-22');
      const again = dun(charge, '2026-12-22');

      expect(run).toEqual({
        retry: true,
        events: [
          BillingEvents.ChargeOverdue,
          BillingEvents.ChargeOverdue,
          BillingEvents.ContractInArrears,
        ],
        status: 'overdue',
      });
      expect(again).toEqual({ retry: false, events: [], status: 'overdue' });
    });

    it('should leave a paid charge alone, and wait for the answer on one being collected', () => {
      const paid = fresh();
      paid.recordSucceeded(paid.submitCollection(MANDATE_ID, NOW), NOW, false);
      paid.pullEvents();
      const collecting = fresh();
      collecting.submitCollection(MANDATE_ID, NOW);
      collecting.pullEvents();

      expect(dun(paid, '2027-03-01')).toEqual({ retry: false, events: [], status: 'paid' });
      expect(dun(collecting, '2026-11-20')).toEqual({
        retry: false,
        events: [],
        status: 'pending',
      });
      expect(collecting.dunningStep).toBe(0);
    });

    it('should clear the arrears of the contract when the last charge in arrears is paid', () => {
      const charge = fresh();
      dun(charge, '2026-12-12');
      const key = charge.submitCollection(MANDATE_ID, NOW);

      charge.recordSucceeded(key, LATER, false);

      expect(eventTypes(charge)).toEqual([
        BillingEvents.ChargeSubmitted,
        BillingEvents.ChargePaid,
        BillingEvents.ArrearsCleared,
      ]);
      expect(charge.inArrears).toBe(false);
    });

    it('should not clear the arrears while another charge keeps the contract in them', () => {
      const charge = fresh();
      dun(charge, '2026-12-12');

      charge.recordSucceeded(charge.submitCollection(MANDATE_ID, NOW), LATER, true);

      expect(eventTypes(charge)).not.toContain(BillingEvents.ArrearsCleared);
    });
  });
});
