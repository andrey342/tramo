import { type Principal } from '@shared/application';
import { EntityNotFoundError, FixedClock, InvalidValueError, type Role } from '@shared/domain';

import {
  aTaxId,
  anActiveTrainingCenter,
  aTrainingCenter,
  OTHER_IBAN,
  VALID_IBAN,
} from '../../../../test/factories/catalog';
import { FakeVatValidator, InMemoryTrainingCenterRepository } from '../../../../test/fakes/catalog';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  CatalogEvents,
  CenterAccessDeniedError,
  CenterAlreadyRegisteredError,
  CenterVatNumberLockedError,
  type TrainingCenter,
} from '../domain';

import {
  RegisterTrainingCenterCommand,
  RegisterTrainingCenterHandler,
} from './commands/register-training-center.command';
import {
  UpdateTrainingCenterCommand,
  UpdateTrainingCenterHandler,
} from './commands/update-training-center.command';
import {
  VerifyCenterVatCommand,
  VerifyCenterVatHandler,
} from './commands/verify-center-vat.command';
import {
  GetTrainingCenterHandler,
  GetTrainingCenterQuery,
} from './queries/get-training-center.query';

const user = (roles: Role[], centerId: string | null = null): Principal => ({
  kind: 'user',
  userId: 'u-1',
  roles,
  centerId,
});
const ADMIN = user(['admin']);
const OPS = user(['ops']);
const STUDENT = user(['student']);

function setup() {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  const uow = new InlineUnitOfWork();
  const events = new RecordingEventBus();
  const centers = new InMemoryTrainingCenterRepository(events);
  const changes: unknown[] = [];
  const vat = new FakeVatValidator();
  return {
    clock,
    uow,
    events,
    centers,
    changes,
    register: new RegisterTrainingCenterHandler(
      uow,
      centers,
      vat,
      { describeChanges: (change) => changes.push(change) },
      clock,
    ),
    verify: new VerifyCenterVatHandler(
      uow,
      centers,
      vat,
      { describeChanges: (change) => changes.push(change) },
      clock,
    ),
    update: new UpdateTrainingCenterHandler(
      uow,
      centers,
      { describeChanges: (change) => changes.push(change) },
      vat,
      clock,
    ),
    get: new GetTrainingCenterHandler(centers),
  };
}

const registered = async (
  t: ReturnType<typeof setup>,
  center: TrainingCenter = aTrainingCenter(),
): Promise<TrainingCenter> => {
  await t.centers.save(center);
  return center;
};

describe('training center use cases', () => {
  describe('RegisterTrainingCenter', () => {
    it('should register a center waiting for its VAT check when an admin asks', async () => {
      const t = setup();

      const { centerId } = await t.register.execute(
        new RegisterTrainingCenterCommand(ADMIN, 'Codeworks', 'ES', 'esb12345678', VALID_IBAN, 500),
      );

      const center = await t.centers.findById(centerId);
      expect(center?.status).toBe('pending_verification');
      expect(center?.vatNumber.toString()).toBe('ESB12345678');
      expect(t.events.ofType(CatalogEvents.CenterRegistered)).toHaveLength(1);
    });

    it('should refuse anyone but an admin, a second center with the same tax id and a bad IBAN', async () => {
      const t = setup();
      const taxId = aTaxId();
      const command = (actor: Principal, iban = VALID_IBAN): RegisterTrainingCenterCommand =>
        new RegisterTrainingCenterCommand(actor, 'Codeworks', 'ES', taxId, iban, 500);

      await expect(t.register.execute(command(OPS))).rejects.toThrow(CenterAccessDeniedError);
      await t.register.execute(command(ADMIN));
      await expect(t.register.execute(command(ADMIN))).rejects.toThrow(
        CenterAlreadyRegisteredError,
      );
      await expect(
        t.register.execute(
          new RegisterTrainingCenterCommand(ADMIN, 'X', 'ES', aTaxId(), 'ES00', 500),
        ),
      ).rejects.toThrow(InvalidValueError);
    });

    it("should take the registry's test numbers as tax ids only while it is the test service", async () => {
      const t = setup();
      const live = new RegisterTrainingCenterHandler(
        new InlineUnitOfWork(),
        t.centers,
        { acceptsTestNumbers: false, check: () => Promise.reject(new Error('not asked')) },
        { describeChanges: () => undefined },
        t.clock,
      );
      const command = new RegisterTrainingCenterCommand(ADMIN, 'X', 'DE', '100', VALID_IBAN, 500);

      await expect(live.execute(command)).rejects.toThrow(InvalidValueError);
      await expect(t.register.execute(command)).resolves.toMatchObject({
        centerId: expect.any(String) as string,
      });
    });
  });

  describe('VerifyCenterVat', () => {
    it('should activate a center whose number the registry confirms', async () => {
      const t = setup();
      const center = await registered(t);

      const { center: result, outcome } = await t.verify.execute(
        new VerifyCenterVatCommand(OPS, center.id),
      );

      expect(outcome).toBe('valid');
      expect(result.status).toBe('active');
      expect(result.vatValidation?.status).toBe('valid');
      expect(t.events.ofType(CatalogEvents.CenterActivated)).toHaveLength(1);
    });

    it('should leave the center unverified, without failing, when the registry is down', async () => {
      const t = setup();
      const center = await registered(t, aTrainingCenter({ taxId: '300' }));

      const { center: result, outcome } = await t.verify.execute(
        new VerifyCenterVatCommand('system', center.id),
      );

      expect(outcome).toBe('unavailable');
      expect(result.status).toBe('pending_verification');
      expect(result.vatValidation?.status).toBe('unverified');
    });

    // The job retries on this answer: the center still shows the earlier verdict.
    it('should report an unavailable registry when a center pending verification was refused before', async () => {
      const t = setup();
      const center = aTrainingCenter({ taxId: '200' });
      center.recordVatCheck({ outcome: 'invalid', provider: 'fake' }, t.clock.now());
      await registered(t, center);
      const down = new VerifyCenterVatHandler(
        t.uow,
        t.centers,
        {
          acceptsTestNumbers: true,
          check: () =>
            Promise.resolve({ outcome: 'unavailable', provider: 'fake', reason: 'TIMEOUT' }),
        },
        { describeChanges: () => undefined },
        t.clock,
      );

      const { center: result, outcome } = await down.execute(
        new VerifyCenterVatCommand('system', center.id),
      );

      expect(outcome).toBe('unavailable');
      expect(result.status).toBe('pending_verification');
      expect(result.vatValidation?.status).toBe('invalid');
    });

    it('should only let staff and the system ask', async () => {
      const t = setup();
      const center = await registered(t);

      await expect(
        t.verify.execute(new VerifyCenterVatCommand(STUDENT, center.id)),
      ).rejects.toThrow(CenterAccessDeniedError);
      await expect(t.verify.execute(new VerifyCenterVatCommand(OPS, 'missing'))).rejects.toThrow(
        EntityNotFoundError,
      );
    });
  });

  describe('UpdateTrainingCenter', () => {
    it('should apply several changes and describe them for the audit log', async () => {
      const t = setup();
      const center = await registered(t, anActiveTrainingCenter());

      const result = await t.update.execute(
        new UpdateTrainingCenterCommand(ADMIN, center.id, {
          name: 'Codeworks Madrid',
          platformFeeBasisPoints: 650,
          payoutIban: OTHER_IBAN,
          status: 'suspended',
          suspensionReason: 'Pending audit',
        }),
      );

      expect(result).toMatchObject({
        name: 'Codeworks Madrid',
        status: 'suspended',
        platformFeeBasisPoints: 650,
      });
      expect(result.payoutIbanMasked).toBe('DE89 **** 3000');
      expect(t.changes).toEqual([
        {
          name: { before: 'Codeworks Barcelona', after: 'Codeworks Madrid' },
          status: { before: 'active', after: 'suspended' },
          platformFeeBasisPoints: { before: 500, after: 650 },
          payoutIbanMasked: { before: 'ES91 **** 1332', after: 'DE89 **** 3000' },
        },
      ]);
      expect(t.events.ofType(CatalogEvents.CenterPayoutAccountChanged)).toHaveLength(1);
    });

    it('should reinstate a suspended center', async () => {
      const t = setup();
      const center = anActiveTrainingCenter();
      center.suspend('Audit', t.clock.now());
      await registered(t, center);

      const result = await t.update.execute(
        new UpdateTrainingCenterCommand(ADMIN, center.id, { status: 'active' }),
      );

      expect(result.status).toBe('active');
    });

    it('should correct the VAT number of a center that is not active and audit it', async () => {
      const t = setup();
      const center = await registered(t);
      const before = center.vatNumber.toString();

      const result = await t.update.execute(
        new UpdateTrainingCenterCommand(ADMIN, center.id, { country: 'DE', taxId: '123456789' }),
      );

      expect(result).toMatchObject({
        country: 'DE',
        taxId: 'DE123456789',
        status: 'pending_verification',
        vatValidation: null,
      });
      expect(t.changes).toEqual([{ taxId: { before, after: 'DE123456789' } }]);
      expect(t.events.ofType(CatalogEvents.CenterVatNumberChanged)).toHaveLength(1);
    });

    it('should refuse a VAT number another center has, and any change when the center is active', async () => {
      const t = setup();
      const taken = await registered(t);
      const center = await registered(t);
      const active = await registered(t, anActiveTrainingCenter());
      const correction = (id: string, taxId: string) =>
        new UpdateTrainingCenterCommand(ADMIN, id, { country: 'ES', taxId });

      await expect(t.update.execute(correction(center.id, taken.vatNumber.number))).rejects.toThrow(
        CenterAlreadyRegisteredError,
      );
      await expect(t.update.execute(correction(active.id, aTaxId()))).rejects.toThrow(
        CenterVatNumberLockedError,
      );
      await expect(t.update.execute(correction(center.id, 'B'))).rejects.toThrow(InvalidValueError);
    });

    it('should suspend an active center and correct its VAT number in one request', async () => {
      const t = setup();
      const center = await registered(t, anActiveTrainingCenter());

      const result = await t.update.execute(
        new UpdateTrainingCenterCommand(ADMIN, center.id, {
          status: 'suspended',
          suspensionReason: 'Wrong tax id',
          country: 'ES',
          taxId: 'B99999999',
        }),
      );

      expect(result).toMatchObject({ status: 'suspended', taxId: 'ESB99999999' });
    });

    it('should have the VAT number checked again when a center is reinstated without a valid one', async () => {
      const t = setup();
      const center = aTrainingCenter();
      center.suspend('Audit', t.clock.now());
      await registered(t, center);

      const result = await t.update.execute(
        new UpdateTrainingCenterCommand(ADMIN, center.id, { status: 'active' }),
      );

      expect(result.status).toBe('pending_verification');
      expect(t.events.ofType(CatalogEvents.CenterReturnedToVerification)).toHaveLength(1);
    });

    it('should be reserved to admins, also for the center itself', async () => {
      const t = setup();
      const center = await registered(t);

      await expect(
        t.update.execute(
          new UpdateTrainingCenterCommand(user(['center_admin'], center.id), center.id, {
            payoutIban: OTHER_IBAN,
          }),
        ),
      ).rejects.toThrow(CenterAccessDeniedError);
    });
  });

  describe('GetTrainingCenter', () => {
    it('should show a center to staff and to its own admins, not to its API keys', async () => {
      const t = setup();
      const center = await registered(t);
      const ownKey: Principal = { kind: 'api_key', apiKeyId: 'k', centerId: center.id, scopes: [] };

      expect(
        (await t.get.execute(new GetTrainingCenterQuery(OPS, center.id))).payoutIbanMasked,
      ).toBe('ES91 **** 1332');
      await expect(
        t.get.execute(new GetTrainingCenterQuery(user(['center_admin'], center.id), center.id)),
      ).resolves.toBeDefined();
      await expect(t.get.execute(new GetTrainingCenterQuery(ownKey, center.id))).rejects.toThrow(
        CenterAccessDeniedError,
      );
      await expect(
        t.get.execute(new GetTrainingCenterQuery(user(['center_admin'], 'other'), center.id)),
      ).rejects.toThrow(CenterAccessDeniedError);
      await expect(t.get.execute(new GetTrainingCenterQuery(STUDENT, center.id))).rejects.toThrow(
        CenterAccessDeniedError,
      );
      await expect(t.get.execute(new GetTrainingCenterQuery(ADMIN, 'missing'))).rejects.toThrow(
        EntityNotFoundError,
      );
    });
  });
});
