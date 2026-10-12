import { InvalidStateTransitionError } from '@shared/domain';

import { aDisbursement, LATER } from '../../../../../test/factories/lending';
import { LendingEvents } from '../events/lending-events';

import { type Disbursement } from './disbursement';

const eventTypes = (disbursement: Disbursement): string[] =>
  disbursement.pullEvents().map((event) => event.eventType);

describe('Disbursement', () => {
  it('should be requested as the first attempt, pending', () => {
    const disbursement = aDisbursement();

    expect(disbursement).toMatchObject({ status: 'pending', attempt: 1, transferId: null });
    expect(disbursement.idempotencyKey).toBe(`${disbursement.id}.1`);
    expect(eventTypes(disbursement)).toEqual([LendingEvents.DisbursementRequested]);
  });

  it('should be settled after the transfer is sent, announcing the amount paid', () => {
    const disbursement = aDisbursement();
    disbursement.pullEvents();

    disbursement.markSent('tr_1', LATER);
    disbursement.settle(LATER);

    expect(disbursement).toMatchObject({ status: 'settled', transferId: 'tr_1', settledAt: LATER });
    expect(disbursement.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: LendingEvents.DisbursementSettled,
        payload: expect.objectContaining({ amountCents: 7_125_00 }),
      }),
    ]);
  });

  it('should not be settled before the transfer is sent, nor sent twice', () => {
    const disbursement = aDisbursement();

    expect(() => {
      disbursement.settle(LATER);
    }).toThrow(InvalidStateTransitionError);
    disbursement.markSent('tr_1', LATER);
    expect(() => {
      disbursement.markSent('tr_2', LATER);
    }).toThrow(InvalidStateTransitionError);
  });

  it('should fail with a reason, and be retried as a new attempt with a new key', () => {
    const disbursement = aDisbursement();
    disbursement.markSent('tr_1', LATER);
    disbursement.pullEvents();

    disbursement.fail('account_closed', LATER);

    expect(disbursement).toMatchObject({ status: 'failed', failureReason: 'account_closed' });
    expect(eventTypes(disbursement)).toEqual([LendingEvents.DisbursementFailed]);

    disbursement.retry(LATER);

    expect(disbursement).toMatchObject({
      status: 'pending',
      attempt: 2,
      transferId: null,
      failureReason: null,
    });
    expect(disbursement.idempotencyKey).toBe(`${disbursement.id}.2`);
  });

  it('should keep a long failure reason short and retry only a failure', () => {
    const disbursement = aDisbursement();

    expect(() => {
      disbursement.retry(LATER);
    }).toThrow(InvalidStateTransitionError);
    disbursement.fail('x'.repeat(500), LATER);
    expect(disbursement.failureReason).toHaveLength(200);
    expect(() => {
      disbursement.fail('again', LATER);
    }).toThrow(InvalidStateTransitionError);
  });
});
