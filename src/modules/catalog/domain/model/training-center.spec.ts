import {
  Iban,
  InvalidStateTransitionError,
  InvalidValueError,
  Percentage,
  unwrap,
} from '@shared/domain';

import {
  aTrainingCenter,
  anActiveTrainingCenter,
  NOW,
  OTHER_IBAN,
} from '../../../../../test/factories/catalog';
import { InvalidPlatformFeeError } from '../errors/catalog-errors';
import { CatalogEvents } from '../events/catalog-events';

const LATER = new Date(NOW.getTime() + 60_000);
const eventTypes = (center: { pullEvents(): readonly { eventType: string }[] }): string[] =>
  center.pullEvents().map((event) => event.eventType);

describe('TrainingCenter', () => {
  it('should start waiting for verification and announce the registration', () => {
    const center = aTrainingCenter({ taxId: 'B12345678' });

    expect(center.status).toBe('pending_verification');
    expect(center.vatValidation).toBeNull();
    expect(center.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: CatalogEvents.CenterRegistered,
        payload: expect.objectContaining({ taxId: 'ESB12345678', country: 'ES' }) as object,
      }),
    ]);
  });

  it('should reject an empty name and a platform fee above 30 %', () => {
    expect(() => aTrainingCenter({ name: '  ' })).toThrow(InvalidValueError);
    expect(() => aTrainingCenter({ feePercent: 31 })).toThrow(InvalidPlatformFeeError);
  });

  describe('VAT checks', () => {
    it('should activate a center when its VAT number is valid', () => {
      const center = aTrainingCenter();
      center.pullEvents();

      center.recordVatCheck(
        { outcome: 'valid', provider: 'vies', registeredName: 'CODEWORKS SL' },
        LATER,
      );

      expect(center.status).toBe('active');
      expect(center.vatValidation).toEqual({
        status: 'valid',
        checkedAt: LATER,
        provider: 'vies',
        registeredName: 'CODEWORKS SL',
      });
      expect(eventTypes(center)).toEqual([CatalogEvents.CenterActivated]);
    });

    it('should record an invalid number without activating', () => {
      const center = aTrainingCenter();
      center.pullEvents();

      center.recordVatCheck({ outcome: 'invalid', provider: 'vies' }, LATER);

      expect(center.status).toBe('pending_verification');
      expect(center.vatValidation?.status).toBe('invalid');
      expect(eventTypes(center)).toEqual([]);
    });

    it('should keep an active center active and tell ops when its number stops being valid', () => {
      const center = anActiveTrainingCenter();

      center.recordVatCheck({ outcome: 'invalid', provider: 'vies' }, LATER);
      center.recordVatCheck({ outcome: 'invalid', provider: 'vies' }, LATER);

      expect(center.status).toBe('active');
      expect(center.vatValidation?.status).toBe('invalid');
      expect(center.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: CatalogEvents.CenterVatInvalidated,
          payload: { centerId: center.id, provider: 'vies' },
        }),
      ]);
    });

    it('should mark an unchecked center unverified when the registry is unavailable', () => {
      const center = aTrainingCenter();

      center.recordVatCheck({ outcome: 'unavailable', provider: 'vies', reason: 'timeout' }, LATER);

      expect(center.status).toBe('pending_verification');
      expect(center.vatValidation?.status).toBe('unverified');
    });

    it('should keep an earlier verdict when the registry is unavailable later', () => {
      const center = anActiveTrainingCenter();

      center.recordVatCheck({ outcome: 'unavailable', provider: 'vies', reason: 'timeout' }, LATER);

      expect(center.vatValidation?.status).toBe('valid');
      expect(center.vatValidation?.checkedAt).toEqual(NOW);
    });

    it('should not announce activation again when an active center is checked again', () => {
      const center = anActiveTrainingCenter();

      center.recordVatCheck({ outcome: 'valid', provider: 'vies', registeredName: null }, LATER);

      expect(eventTypes(center)).toEqual([]);
    });
  });

  describe('suspension', () => {
    it('should suspend with a reason and reinstate to active when the VAT number is valid', () => {
      const center = anActiveTrainingCenter();

      center.suspend('Chargeback investigation', LATER);
      center.reinstate(LATER);

      expect(center.status).toBe('active');
      expect(eventTypes(center)).toEqual([
        CatalogEvents.CenterSuspended,
        CatalogEvents.CenterActivated,
      ]);
    });

    it('should reinstate an unverified center to waiting for verification', () => {
      const center = aTrainingCenter();
      center.suspend('Duplicate', LATER);

      center.reinstate(LATER);

      expect(center.status).toBe('pending_verification');
    });

    it('should refuse to suspend twice, to reinstate an active center and an empty reason', () => {
      const center = anActiveTrainingCenter();

      expect(() => {
        center.reinstate(LATER);
      }).toThrow(InvalidStateTransitionError);
      expect(() => {
        center.suspend(' ', LATER);
      }).toThrow(InvalidValueError);
      center.suspend('Fraud check', LATER);
      expect(() => {
        center.suspend('Again', LATER);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  it('should announce a new payout account by its last digits only, and ignore the same one', () => {
    const center = anActiveTrainingCenter();
    const other = unwrap(Iban.create(OTHER_IBAN));

    center.changePayoutIban(center.payoutIban, LATER);
    center.changePayoutIban(other, LATER);

    expect(center.payoutIban.equals(other)).toBe(true);
    expect(center.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: CatalogEvents.CenterPayoutAccountChanged,
        payload: { centerId: center.id, ibanLastFour: '3000' },
      }),
    ]);
  });

  it('should rename and change the fee within the limits, announcing real changes', () => {
    const center = anActiveTrainingCenter();

    center.rename('  Codeworks Madrid ', LATER);
    center.rename('Codeworks Madrid', LATER);
    center.changePlatformFee(Percentage.fromPercent(7.5), LATER);
    center.changePlatformFee(Percentage.fromPercent(7.5), LATER);

    expect(center.name).toBe('Codeworks Madrid');
    expect(center.platformFee.basisPoints).toBe(750);
    expect(center.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: CatalogEvents.CenterRenamed,
        payload: { centerId: center.id, name: 'Codeworks Madrid' },
      }),
      expect.objectContaining({
        eventType: CatalogEvents.CenterPlatformFeeChanged,
        payload: { centerId: center.id, platformFeeBasisPoints: 750 },
      }),
    ]);
    expect(() => {
      center.changePlatformFee(Percentage.fromPercent(40), LATER);
    }).toThrow(InvalidPlatformFeeError);
  });
});
