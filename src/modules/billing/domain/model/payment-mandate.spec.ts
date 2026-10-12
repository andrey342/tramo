import { InvalidStateTransitionError } from '@shared/domain';

import { aMandate, LATER } from '../../../../../test/factories/billing';
import { BillingEvents } from '../events/billing-events';

describe('PaymentMandate', () => {
  it('should be signed active with a SEPA reference, and announced without the IBAN', () => {
    const mandate = aMandate();

    expect(mandate.status).toBe('active');
    expect(mandate.reference).toMatch(/^TRAMO-[0-9A-F]{16}$/);
    const [event] = mandate.pullEvents();
    expect(event?.eventType).toBe(BillingEvents.MandateSigned);
    expect(JSON.stringify(event?.payload)).not.toContain(mandate.iban.value);
  });

  it('should be revoked once', () => {
    const mandate = aMandate();
    mandate.pullEvents();

    mandate.revoke(LATER);

    expect(mandate).toMatchObject({ status: 'revoked', revokedAt: LATER });
    expect(mandate.pullEvents().map((event) => event.eventType)).toEqual([
      BillingEvents.MandateRevoked,
    ]);
    expect(() => {
      mandate.revoke(LATER);
    }).toThrow(InvalidStateTransitionError);
  });
});
