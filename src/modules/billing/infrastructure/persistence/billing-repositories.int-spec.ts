import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { billingRepositoriesContract } from '../../../../../test/contracts/billing-repositories.contract';
import { aCharge, aMandate, NOW } from '../../../../../test/factories/billing';
import {
  BILLING_QUERIES,
  type BillingQueries,
  DECLARATION_REMINDERS,
  type DeclarationReminders,
} from '../../application/ports/billing-ports';
import { BillingModule } from '../../billing.module';
import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  INCOME_DECLARATION_REPOSITORY,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
} from '../../domain';

import { LedgerWriter } from './typeorm-billing.queries';

describe('billing repositories (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), BillingModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
  });

  afterAll(async () => {
    await app.close();
  });

  billingRepositoriesContract('TypeORM', () => ({
    charges: app.get(CHARGE_REPOSITORY),
    mandates: app.get(PAYMENT_MANDATE_REPOSITORY),
    declarations: app.get(INCOME_DECLARATION_REPOSITORY),
    queries: app.get(BILLING_QUERIES),
    run: (work) => uow.run(work),
  }));

  it('should keep the IBAN of a mandate encrypted and bound to its row', async () => {
    const mandate = aMandate();
    await uow.run(() =>
      app.get<PaymentMandateRepository>(PAYMENT_MANDATE_REPOSITORY).save(mandate),
    );

    const [row] = await app
      .get(DataSource)
      .query<{ iban_encrypted: string }[]>(
        'SELECT iban_encrypted FROM billing.payment_mandates WHERE id = $1',
        [mandate.id],
      );

    expect(row?.iban_encrypted).not.toContain(mandate.iban.value.slice(-8));
  });

  it('should write one ledger line per event and read the statement in order', async () => {
    const charge = aCharge();
    await uow.run(() => app.get<ChargeRepository>(CHARGE_REPOSITORY).save(charge));
    const ledger = app.get(LedgerWriter);
    const line = {
      contractId: charge.contractId,
      chargeId: charge.id,
      description: 'Instalment due 2026-11-12',
      occurredAt: NOW,
    };
    const chargeEvent = uuidv7();

    await uow.run(async () => {
      await ledger.append({ ...line, eventId: chargeEvent, type: 'charge', amountCents: 337_50 });
      await ledger.append({ ...line, eventId: chargeEvent, type: 'charge', amountCents: 337_50 });
      await ledger.append({
        ...line,
        eventId: uuidv7(),
        type: 'payment',
        amountCents: -337_50,
        occurredAt: new Date(NOW.getTime() + 1_000),
      });
    });

    const entries = await uow.run(() =>
      app.get<BillingQueries>(BILLING_QUERIES).ledger(charge.contractId),
    );
    expect(entries.map((entry) => [entry.type, entry.amountCents])).toEqual([
      ['charge', 337_50],
      ['payment', -337_50],
    ]);
  });

  // A charge raised and written off at once: both events share their instant, and the write-off's
  // consumer may run first. The statement follows the events, not the consumers.
  it('should list lines of one instant in the order of their events', async () => {
    const charge = aCharge();
    await uow.run(() => app.get<ChargeRepository>(CHARGE_REPOSITORY).save(charge));
    const ledger = app.get(LedgerWriter);
    const line = { contractId: charge.contractId, chargeId: charge.id, occurredAt: NOW };
    const [created, writtenOff] = [uuidv7(), uuidv7()];

    await uow.run(async () => {
      await ledger.append({
        ...line,
        eventId: writtenOff,
        type: 'write_off',
        amountCents: -337_50,
        description: 'Written off on default, passed to collections',
      });
      await ledger.append({
        ...line,
        eventId: created,
        type: 'charge',
        amountCents: 337_50,
        description: 'Principal left to bill on default',
      });
    });

    const entries = await uow.run(() =>
      app.get<BillingQueries>(BILLING_QUERIES).ledger(charge.contractId),
    );
    expect(entries.map((entry) => entry.type)).toEqual(['charge', 'write_off']);
  });

  it('should send one declaration reminder per contract and month', async () => {
    const reminders = app.get<DeclarationReminders>(DECLARATION_REMINDERS);
    const contractId = uuidv7();

    const first = await uow.run(() => reminders.record(contractId, '2026-11'));
    const again = await uow.run(() => reminders.record(contractId, '2026-11'));
    const next = await uow.run(() => reminders.record(contractId, '2026-12'));

    expect([first, again, next]).toEqual([true, false, true]);
  });
});
