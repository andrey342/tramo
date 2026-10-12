import { InvalidStateTransitionError } from '@shared/domain';

import { aCharge, day, LATER, NOW } from '../../../../../test/factories/billing';
import { UnknownCollectionAttemptError } from '../errors/billing-errors';
import { BillingEvents } from '../events/billing-events';

import { type Charge } from './charge';

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

  describe('collection', () => {
    it('should be paid through an attempt whose key the provider echoes, once', () => {
      const charge = fresh();

      const key = charge.submitCollection(NOW);
      charge.recordAccepted(key, 'pay-1');
      charge.recordAccepted(key, 'pay-2');
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
        onTime.submitCollection(NOW),
        'insufficient_funds',
        day('2026-11-12'),
        NOW,
      );
      late.recordFailed(late.submitCollection(NOW), '', day('2026-11-15'), NOW);

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
        charge.submitCollection(NOW),
        'insufficient_funds',
        day('2026-11-12'),
        NOW,
      );

      const second = charge.submitCollection(LATER);

      expect(second).toBe(`${charge.id}.2`);
      expect(charge.status).toBe('pending');
      expect(charge.attempts).toHaveLength(2);
    });

    it('should refuse callbacks that do not fit', () => {
      const charge = fresh();
      const key = charge.submitCollection(NOW);

      expect(() => {
        charge.recordSucceeded(`${charge.id}.9`, NOW, false);
      }).toThrow(UnknownCollectionAttemptError);
      charge.recordSucceeded(key, NOW, false);
      expect(() => {
        charge.recordFailed(key, 'late', day('2026-11-12'), NOW);
      }).toThrow(InvalidStateTransitionError);
      expect(() => charge.submitCollection(NOW)).toThrow(InvalidStateTransitionError);
    });

    it('should be cancelled only before collection starts', () => {
      const charge = fresh();

      charge.cancel(NOW);
      charge.cancel(NOW);

      expect(charge.status).toBe('cancelled');
      expect(eventTypes(charge)).toEqual([BillingEvents.ChargeCancelled]);
      const collecting = fresh();
      collecting.submitCollection(NOW);
      expect(() => {
        collecting.cancel(NOW);
      }).toThrow(InvalidStateTransitionError);
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
      paid.recordSucceeded(paid.submitCollection(NOW), NOW, false);
      paid.pullEvents();
      const collecting = fresh();
      collecting.submitCollection(NOW);
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
      const key = charge.submitCollection(NOW);

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

      charge.recordSucceeded(charge.submitCollection(NOW), LATER, true);

      expect(eventTypes(charge)).not.toContain(BillingEvents.ArrearsCleared);
    });
  });
});
